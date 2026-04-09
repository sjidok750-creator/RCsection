import { useState, useCallback } from 'react'
import type { CheckResult, CheckItem, CalcLine, CheckStatus } from '../../types'
import { useResponsive } from '../../hooks/useResponsive'
import ResultTable from '../common/ResultTable'

// ── 상수 ────────────────────────────────────────────────────────
const REBAR_AREA: Record<number, number> = {
  10: 71.3, 13: 126.7, 16: 198.6, 19: 286.5,
  22: 387.1, 25: 506.7, 29: 642.4, 32: 794.2, 35: 956.6,
}
const REBAR_DIAS = [10, 13, 16, 19, 22, 25, 29, 32, 35]

// ── 타입 ────────────────────────────────────────────────────────
type FoundationType = 'spread' | 'pile'
type PileType = 'PHC' | 'steel-pipe' | 'cast-in-place' | 'H-pile'
type PileArrange = 'single-row' | 'double-row' | 'matrix'

interface SpreadGeom {
  // 기초판
  B: number      // 기초판 폭 (단변, m)
  L: number      // 기초판 길이 (장변, m)
  D: number      // 근입 깊이 (m)
  t: number      // 기초판 두께 (mm)
  // 기둥/교각 단면
  colB: number   // 기둥 폭 (mm)
  colL: number   // 기둥 길이 (mm)
}

interface PileGeom {
  // 기초 캡
  B: number      // 기초 캡 폭 (m)
  L: number      // 기초 캡 길이 (m)
  t: number      // 기초 캡 두께 (mm)
  D: number      // 근입 깊이 (m)
  // 말뚝
  pileDia: number        // 말뚝 직경 (mm)
  pileLen: number        // 말뚝 길이 (m)
  pileSpacing: number    // 말뚝 간격 (m) — 중심 간격
  pileType: PileType
  arrange: PileArrange
  nRow: number           // 행 수
  nCol: number           // 열 수
  // 허용 지지력
  Ra_single: number      // 말뚝 1개 허용 지지력 (kN)
  Ra_lateral: number     // 말뚝 1개 허용 횡방향 지지력 (kN)
  // 기둥/교각
  colB: number
  colL: number
}

interface FoundMaterial {
  fck: number
  fy: number
  Es: number
  gammaConcrete: number  // kN/m³
}

interface FoundLoad {
  // 기둥 하단 하중 (계수하중 및 사용하중)
  Pu: number     // 계수 축력 (kN) — 단면검토용
  P:  number     // 사용 축력 (kN) — 지반검토용
  Mu: number     // 계수 모멘트 (kN·m) — 강축
  M:  number     // 사용 모멘트 (kN·m)
  Vu: number     // 계수 전단력 (kN)
  V:  number     // 사용 전단력 (kN)
}

interface SpreadSoil {
  qa: number           // 허용 지지력 (kPa)
  gammaS: number       // 흙 단위중량 (kN/m³)
  mu: number           // 활동 마찰계수
}

interface FootRebar {
  // B방향 (단변, 주근)
  botBDia: number
  botBSpacing: number
  // L방향 (장변)
  botLDia: number
  botLSpacing: number
  cover: number
}

// ── 기본값 ───────────────────────────────────────────────────────
const DEF_MAT: FoundMaterial = { fck: 27, fy: 400, Es: 200000, gammaConcrete: 24 }
const DEF_LOAD: FoundLoad = { Pu: 5000, P: 3500, Mu: 800, M: 550, Vu: 400, V: 280 }
const DEF_SPREAD_GEOM: SpreadGeom = { B: 4.0, L: 5.0, D: 2.5, t: 900, colB: 1000, colL: 1200 }
const DEF_SPREAD_SOIL: SpreadSoil = { qa: 300, gammaS: 18, mu: 0.5 }
const DEF_PILE_GEOM: PileGeom = {
  B: 4.5, L: 6.0, t: 1200, D: 2.0,
  pileDia: 600, pileLen: 15, pileSpacing: 1.8,
  pileType: 'PHC', arrange: 'matrix', nRow: 2, nCol: 3,
  Ra_single: 1200, Ra_lateral: 120,
  colB: 1000, colL: 1200,
}
const DEF_FOOT_REB: FootRebar = { botBDia: 25, botBSpacing: 150, botLDia: 22, botLSpacing: 150, cover: 80 }

// ── 헬퍼 ────────────────────────────────────────────────────────
function ln(t: string, v?: string, indent = 0, type: CalcLine['type'] = 'eq'): CalcLine {
  return { type, text: t, value: v, indent }
}
function sec(t: string): CalcLine { return { type: 'section', text: t } }
function verdict(ok: boolean, demand: number, capacity: number, unit: string): CalcLine {
  return {
    type: 'verdict',
    text: ok ? '✓ O.K.' : '✗ N.G.',
    value: `${demand.toFixed(2)} / ${capacity.toFixed(2)} ${unit} = ${(demand / capacity).toFixed(3)}`,
  }
}
function note(t: string): CalcLine { return { type: 'note', text: t } }

function rebarAs(dia: number, spacing: number): number {
  return ((REBAR_AREA[dia] ?? 0) / spacing) * 1000  // mm²/m
}

// ── 직접기초 계산 ────────────────────────────────────────────────
function calcSpread(
  geom: SpreadGeom, mat: FoundMaterial, soil: SpreadSoil,
  load: FoundLoad, reb: FootRebar,
): CheckResult {
  const items: CheckItem[] = []
  const warns: string[] = []

  const { fck, fy, gammaConcrete } = mat
  const phi_flex = 0.85
  const phi_shear = 0.75
  const lambda = 1.0

  // ── 1. 지반 지지력 ────────────────────────────────────────────
  const W_found = gammaConcrete * geom.B * geom.L * geom.t / 1000  // kN
  const W_soil  = soil.gammaS * geom.B * geom.L * (geom.D - geom.t / 1000)  // kN
  const P_total = load.P + W_found + W_soil
  const Beff = geom.B - 2 * (load.M / load.P)  // Meyerhof 유효폭
  const Leff = geom.L
  const q_max = P_total / (Math.max(Beff, 0.1) * Leff)
  const ok_bc = q_max <= soil.qa
  {
    const e = load.M / load.P
    const steps: CalcLine[] = [
      sec('■ 지반 지지력 검토 (KDS 11 50 15)'),
      ln(`자중 W_기초 = γc·B·L·t = ${gammaConcrete}×${geom.B}×${geom.L}×${geom.t/1000}`, `${W_found.toFixed(1)} kN`),
      ln(`자중 W_토 = γs·B·L·(D-t) = ${soil.gammaS}×${geom.B}×${geom.L}×${(geom.D-geom.t/1000).toFixed(2)}`, `${W_soil.toFixed(1)} kN`),
      ln(`전체 수직력 P_total = P + W_기초 + W_토 = ${load.P} + ${W_found.toFixed(1)} + ${W_soil.toFixed(1)}`, `${P_total.toFixed(1)} kN`),
      ln(`편심 e = M/P = ${load.M}/${load.P}`, `${e.toFixed(3)} m`),
      e > geom.B/6 ? { type: 'verdict' as const, text: '⚠ e > B/6 — 편심 과대', value: '' } : note(`e = ${e.toFixed(3)}m ≤ B/6 = ${(geom.B/6).toFixed(3)}m ✓`),
      ln(`유효폭 B' = B - 2e = ${geom.B} - 2×${e.toFixed(3)}`, `${Beff.toFixed(3)} m`),
      ln(`q_max = P_total / (B'·L) = ${P_total.toFixed(1)} / (${Beff.toFixed(3)}×${Leff})`, `${q_max.toFixed(1)} kPa`, 0, 'result'),
      verdict(ok_bc, q_max, soil.qa, 'kPa'),
    ]
    if (!ok_bc) warns.push('지반 지지력 초과')
    if (e > geom.B / 6) warns.push('편심 e > B/6 — 기초 재검토 필요')
    items.push({
      id: 'bearing', label: '지반 지지력', demandSymbol: 'q_max', capacitySymbol: 'qa',
      demand: q_max, capacity: soil.qa, unit: 'kPa',
      SF: soil.qa / q_max, ratio: q_max / soil.qa,
      status: ok_bc ? 'OK' : 'NG',
      formula: 'q_max = P_total / (B\'·L) ≤ qa',
      detail: {}, steps,
    })
  }

  // ── 2. 기초판 휨 강도 (단변 B방향, 위험단면 = 기둥면) ──────────
  const q_net = load.Pu / (geom.B * geom.L)  // 계수 순 지반반력 (kPa), 자중 제외 근사
  const L_cant_B = (geom.B * 1000 - geom.colB) / 2 / 1000  // 캔틸레버 길이 (m)
  const L_cant_L = (geom.L * 1000 - geom.colL) / 2 / 1000
  const Mu_B = q_net * L_cant_B ** 2 / 2  // kN·m/m
  const Mu_L = q_net * L_cant_L ** 2 / 2

  const dB = geom.t - reb.cover - reb.botBDia / 2  // mm
  const dL = geom.t - reb.cover - reb.botBDia - reb.botLDia / 2

  const As_B = rebarAs(reb.botBDia, reb.botBSpacing)
  const As_L = rebarAs(reb.botLDia, reb.botLSpacing)

  const calcFlex = (As: number, d: number, Mu: number, dir: string, dia: number, sp: number): CheckItem => {
    const b = 1000
    const a = (As * fy) / (0.85 * fck * b)
    const phiMn = phi_flex * As * fy * (d - a / 2) / 1e6
    const ok = phiMn >= Mu
    if (!ok) warns.push(`기초판 ${dir}방향 휨 강도 부족`)
    const steps: CalcLine[] = [
      sec(`■ 기초판 ${dir}방향 휨 강도 (KDS 14 20 20)`),
      note(`위험단면: 기둥(교각) 전면`),
      ln(`캔틸레버 길이 L_cant = (${dir === 'B' ? geom.B+'×1000-'+geom.colB : geom.L+'×1000-'+geom.colL})/2`, `${(dir === 'B' ? L_cant_B : L_cant_L).toFixed(3)} m`),
      ln(`순 지반반력 q_net = Pu/(B·L) = ${load.Pu}/(${geom.B}×${geom.L})`, `${q_net.toFixed(1)} kPa`),
      ln(`Mu = q_net·L²/2 = ${q_net.toFixed(1)}×${(dir==='B'?L_cant_B:L_cant_L).toFixed(3)}²/2`, `${Mu.toFixed(1)} kN·m/m`),
      ln(`D${dia}@${sp}, As = ${As.toFixed(0)} mm²/m`),
      ln(`유효깊이 d`, `${d.toFixed(0)} mm`),
      ln(`a = As·fy/(0.85·fck·b) = ${As.toFixed(0)}×${fy}/(0.85×${fck}×1000)`, `${a.toFixed(1)} mm`),
      ln(`φMn = φ·As·fy·(d-a/2)/10⁶`, `${phiMn.toFixed(2)} kN·m/m`, 0, 'result'),
      verdict(ok, Mu, phiMn, 'kN·m/m'),
    ]
    return {
      id: `flex-${dir}`, label: `기초판 ${dir}방향 휨`, demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Mu, capacity: phiMn, unit: 'kN·m/m',
      SF: phiMn / Mu, ratio: Mu / phiMn,
      status: ok ? 'OK' : 'NG',
      formula: 'Mu = q·L²/2 ≤ φMn',
      detail: {}, steps,
    }
  }
  items.push(calcFlex(As_B, dB, Mu_B, 'B', reb.botBDia, reb.botBSpacing))
  items.push(calcFlex(As_L, dL, Mu_L, 'L', reb.botLDia, reb.botLSpacing))

  // ── 3. 1방향 전단 (빔전단) ────────────────────────────────────
  // 위험단면: 기둥면에서 d 떨어진 단면
  const d_shear = Math.min(dB, dL)
  const L_shear_B = L_cant_B - d_shear / 1000
  const Vu_1way = q_net * Math.max(L_shear_B, 0)
  const Vc_1way = (lambda / 6) * Math.sqrt(fck) * 1000 * d_shear / 1000  // kN/m
  const phiVc_1way = phi_shear * Vc_1way
  const ok_v1 = phiVc_1way >= Vu_1way
  {
    const steps: CalcLine[] = [
      sec('■ 1방향 전단 검토 (KDS 14 20 22)'),
      note('위험단면: 기둥(교각) 전면에서 유효깊이 d 떨어진 위치'),
      ln(`유효깊이 d (최소)`, `${d_shear.toFixed(0)} mm`),
      ln(`위험단면까지 거리 = ${L_cant_B.toFixed(3)} - ${(d_shear/1000).toFixed(3)}`, `${L_shear_B.toFixed(3)} m`),
      ln(`Vu = q_net × L_shear = ${q_net.toFixed(1)} × ${L_shear_B.toFixed(3)}`, `${Vu_1way.toFixed(1)} kN/m`),
      ln(`Vc = (λ/6)·√fck·b·d = (${lambda}/6)×√${fck}×1000×${d_shear.toFixed(0)}/1000`, `${Vc_1way.toFixed(1)} kN/m`),
      ln(`φVc = ${phi_shear}×${Vc_1way.toFixed(1)}`, `${phiVc_1way.toFixed(1)} kN/m`, 0, 'result'),
      verdict(ok_v1, Vu_1way, phiVc_1way, 'kN/m'),
    ]
    if (!ok_v1) warns.push('1방향 전단 강도 부족')
    items.push({
      id: 'shear-1way', label: '1방향 전단 (빔전단)', demandSymbol: 'Vu', capacitySymbol: 'φVc',
      demand: Vu_1way, capacity: phiVc_1way, unit: 'kN/m',
      SF: phiVc_1way / Vu_1way, ratio: Vu_1way / phiVc_1way,
      status: ok_v1 ? 'OK' : 'NG',
      formula: 'Vu ≤ φVc = φ(λ/6)√fck·b·d',
      detail: {}, steps,
    })
  }

  // ── 4. 2방향 전단 (펀칭전단) ─────────────────────────────────
  // 임계주변: 기둥면에서 d/2 떨어진 사각형 주변
  const d_punch = Math.min(dB, dL)
  const c1 = geom.colB + d_punch  // 임계주변 단변 (mm)
  const c2 = geom.colL + d_punch  // 임계주변 장변 (mm)
  const bo = 2 * (c1 + c2)        // 임계주변 길이 (mm)
  const Vu_punch = load.Pu - q_net * (c1 / 1000) * (c2 / 1000)  // kN
  // KDS 14 20 22 펀칭전단 강도 (가장 작은 값)
  const beta = Math.max(geom.colL, geom.colB) / Math.min(geom.colL, geom.colB)
  const alphaS = 40  // 내부기둥
  const vc1 = (1 / 3) * lambda * Math.sqrt(fck)
  const vc2 = (1 / 6) * lambda * (1 + 2 / beta) * Math.sqrt(fck)
  const vc3 = (1 / 12) * (alphaS * d_punch / bo + 2) * lambda * Math.sqrt(fck)
  const vc = Math.min(vc1, vc2, vc3)
  const phiVn_punch = phi_shear * vc * bo * d_punch / 1000  // kN
  const ok_punch = phiVn_punch >= Vu_punch
  {
    const steps: CalcLine[] = [
      sec('■ 2방향 전단(펀칭전단) 검토 (KDS 14 20 22)'),
      ln(`임계주변 bo: c1 = ${geom.colB}+d = ${c1.toFixed(0)}mm, c2 = ${geom.colL}+d = ${c2.toFixed(0)}mm`),
      ln(`bo = 2(c1+c2) = 2×(${c1.toFixed(0)}+${c2.toFixed(0)})`, `${bo.toFixed(0)} mm`),
      ln(`설계 펀칭전단력 Vu = Pu - q·c1·c2 = ${load.Pu} - ${q_net.toFixed(1)}×${(c1/1000).toFixed(2)}×${(c2/1000).toFixed(2)}`, `${Vu_punch.toFixed(1)} kN`),
      ln(`β = 장변/단변 = ${Math.max(geom.colL,geom.colB)}/${Math.min(geom.colL,geom.colB)}`, `${beta.toFixed(2)}`),
      ln(`vc1 = (1/3)·λ·√fck`, `${vc1.toFixed(3)} MPa`),
      ln(`vc2 = (1/6)·λ·(1+2/β)·√fck`, `${vc2.toFixed(3)} MPa`),
      ln(`vc3 = (1/12)·(αs·d/bo+2)·λ·√fck`, `${vc3.toFixed(3)} MPa`),
      ln(`vc = min(vc1, vc2, vc3)`, `${vc.toFixed(3)} MPa`, 0, 'eq-key'),
      ln(`φVn = φ·vc·bo·d = ${phi_shear}×${vc.toFixed(3)}×${bo.toFixed(0)}×${d_punch.toFixed(0)}/1000`, `${phiVn_punch.toFixed(1)} kN`, 0, 'result'),
      verdict(ok_punch, Vu_punch, phiVn_punch, 'kN'),
    ]
    if (!ok_punch) warns.push('2방향 펀칭전단 강도 부족')
    items.push({
      id: 'punching', label: '2방향 펀칭전단', demandSymbol: 'Vu', capacitySymbol: 'φVn',
      demand: Vu_punch, capacity: phiVn_punch, unit: 'kN',
      SF: phiVn_punch / Vu_punch, ratio: Vu_punch / phiVn_punch,
      status: ok_punch ? 'OK' : 'NG',
      formula: 'Vu ≤ φVn = φ·vc·bo·d',
      detail: {}, steps,
    })
  }

  const overallStatus: CheckStatus = items.some(i => i.status === 'NG')
    ? 'NG' : items.some(i => i.status === 'WARN') ? 'WARN' : 'OK'
  return { moduleId: 'foundation', items, overallStatus, maxRatio: Math.max(...items.map(i => i.ratio)), warnings: warns }
}

// ── 말뚝기초 계산 ────────────────────────────────────────────────
function calcPile(
  geom: PileGeom, mat: FoundMaterial,
  load: FoundLoad, reb: FootRebar,
): CheckResult {
  const items: CheckItem[] = []
  const warns: string[] = []
  const { fck, fy, gammaConcrete } = mat
  const phi_flex = 0.85
  const phi_shear = 0.75
  const lambda = 1.0

  const nPile = geom.nRow * geom.nCol

  // ── 1. 말뚝 연직 지지력 ──────────────────────────────────────
  const W_cap = gammaConcrete * geom.B * geom.L * geom.t / 1000
  const P_total = load.P + W_cap

  // 최대 말뚝 반력 (모멘트 편심)
  // 말뚝 배치 중심 기준 x좌표 (등간격)
  const xs: number[] = []
  const ys: number[] = []
  for (let r = 0; r < geom.nRow; r++) {
    for (let c = 0; c < geom.nCol; c++) {
      xs.push((c - (geom.nCol - 1) / 2) * geom.pileSpacing)
      ys.push((r - (geom.nRow - 1) / 2) * geom.pileSpacing)
    }
  }
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)
  const sumY2 = ys.reduce((a, y) => a + y * y, 0)
  const xMax = Math.max(...xs.map(Math.abs))
  const yMax = Math.max(...ys.map(Math.abs))
  const P_max = P_total / nPile + load.M * xMax / (sumX2 || 1) + load.V * yMax / (sumY2 || 1)
  const P_min = P_total / nPile - load.M * xMax / (sumX2 || 1) - load.V * yMax / (sumY2 || 1)
  const ok_pile_v = P_max <= geom.Ra_single
  {
    const steps: CalcLine[] = [
      sec('■ 말뚝 연직 지지력 검토 (KDS 11 50 20)'),
      ln(`말뚝 수 n = ${geom.nRow}행 × ${geom.nCol}열`, `${nPile}개`),
      ln(`기초 캡 자중 W = ${gammaConcrete}×${geom.B}×${geom.L}×${geom.t/1000}`, `${W_cap.toFixed(1)} kN`),
      ln(`전체 수직력 P_total = P + W = ${load.P} + ${W_cap.toFixed(1)}`, `${P_total.toFixed(1)} kN`),
      ln(`Σxi² = ${sumX2.toFixed(3)} m², x_max = ${xMax.toFixed(3)} m`),
      ln(`최대 말뚝반력 P_max = P/n + M·x_max/Σxi² + V·y_max/Σyi²`),
      ln(`  = ${P_total.toFixed(1)}/${nPile} + ${load.M}×${xMax.toFixed(3)}/${sumX2.toFixed(3)} + ${load.V}×${yMax.toFixed(3)}/${(sumY2||1).toFixed(3)}`,
        `${P_max.toFixed(1)} kN`, 1, 'result'),
      ln(`허용 지지력 Ra`, `${geom.Ra_single} kN`),
      verdict(ok_pile_v, P_max, geom.Ra_single, 'kN'),
      P_min < 0 ? { type: 'verdict' as const, text: `⚠ P_min = ${P_min.toFixed(1)} kN < 0 — 인발 검토 필요`, value: '' } : note(`P_min = ${P_min.toFixed(1)} kN > 0 ✓`),
    ]
    if (!ok_pile_v) warns.push('말뚝 연직 지지력 초과')
    if (P_min < 0) warns.push('인발 말뚝 발생 — 인발 지지력 별도 검토')
    items.push({
      id: 'pile-vertical', label: '말뚝 연직 지지력', demandSymbol: 'P_max', capacitySymbol: 'Ra',
      demand: P_max, capacity: geom.Ra_single, unit: 'kN',
      SF: geom.Ra_single / P_max, ratio: P_max / geom.Ra_single,
      status: ok_pile_v ? 'OK' : 'NG',
      formula: 'P_max = P/n ± M·x/Σx² ≤ Ra',
      detail: {}, steps,
    })
  }

  // ── 2. 말뚝 횡방향 지지력 ────────────────────────────────────
  const H_per_pile = (load.V + load.M / (geom.pileSpacing * (geom.nRow - 1 || 1))) / nPile
  const ok_pile_h = H_per_pile <= geom.Ra_lateral
  {
    const steps: CalcLine[] = [
      sec('■ 말뚝 횡방향 지지력 검토 (KDS 11 50 20)'),
      ln(`말뚝 1개 횡방향 하중 H/n = ${load.V} / ${nPile}`, `${(load.V/nPile).toFixed(1)} kN`),
      note('모멘트에 의한 횡방향 성분은 기초 캡 강결 시 무시 (힌지 가정 시 추가 검토 필요)'),
      ln(`횡방향 허용 지지력 Ra_lat`, `${geom.Ra_lateral} kN`),
      verdict(ok_pile_h, H_per_pile, geom.Ra_lateral, 'kN'),
    ]
    if (!ok_pile_h) warns.push('말뚝 횡방향 지지력 초과')
    items.push({
      id: 'pile-lateral', label: '말뚝 횡방향 지지력', demandSymbol: 'H_pile', capacitySymbol: 'Ra_lat',
      demand: H_per_pile, capacity: geom.Ra_lateral, unit: 'kN',
      SF: geom.Ra_lateral / H_per_pile, ratio: H_per_pile / geom.Ra_lateral,
      status: ok_pile_h ? 'OK' : 'NG',
      formula: 'H_pile = V/n ≤ Ra_lat',
      detail: {}, steps,
    })
  }

  // ── 3. 기초 캡 휨 강도 (B방향) ──────────────────────────────
  const L_cant_B = (geom.B * 1000 - geom.colB) / 2 / 1000
  const L_cant_L = (geom.L * 1000 - geom.colL) / 2 / 1000
  const q_cap_B = P_max * geom.nRow / geom.L  // 단위 길이당 말뚝반력 합 (kN/m)
  const Mu_cap_B = q_cap_B * L_cant_B  // kN·m/m (말뚝 기초: 집중력 캔틸레버)
  const dB = geom.t - reb.cover - reb.botBDia / 2
  const dL = geom.t - reb.cover - reb.botBDia - reb.botLDia / 2
  const As_B = rebarAs(reb.botBDia, reb.botBSpacing)
  const As_L = rebarAs(reb.botLDia, reb.botLSpacing)

  const calcCapFlex = (As: number, d: number, Mu: number, dir: string, dia: number, sp: number): CheckItem => {
    const b = 1000
    const a = (As * fy) / (0.85 * fck * b)
    const phiMn = phi_flex * As * fy * (d - a / 2) / 1e6
    const ok = phiMn >= Mu
    if (!ok) warns.push(`기초 캡 ${dir}방향 휨 강도 부족`)
    const steps: CalcLine[] = [
      sec(`■ 기초 캡 ${dir}방향 휨강도 (KDS 14 20 20)`),
      ln(`캔틸레버 길이 L_cant = ${L_cant_B.toFixed(3)} m`),
      ln(`D${dia}@${sp}, As = ${As.toFixed(0)} mm²/m, d = ${d.toFixed(0)} mm`),
      ln(`Mu = P_말뚝합 × L_cant`, `${Mu.toFixed(1)} kN·m/m`),
      ln(`a = ${As.toFixed(0)}×${fy}/(0.85×${fck}×1000)`, `${a.toFixed(1)} mm`),
      ln(`φMn = ${phi_flex}×${As.toFixed(0)}×${fy}×(${d.toFixed(0)}-${(a/2).toFixed(1)})/10⁶`, `${phiMn.toFixed(1)} kN·m/m`, 0, 'result'),
      verdict(ok, Mu, phiMn, 'kN·m/m'),
    ]
    return {
      id: `cap-flex-${dir}`, label: `기초 캡 ${dir}방향 휨`, demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Mu, capacity: phiMn, unit: 'kN·m/m',
      SF: phiMn / Mu, ratio: Mu / phiMn,
      status: ok ? 'OK' : 'NG',
      formula: 'Mu ≤ φMn',
      detail: {}, steps,
    }
  }
  items.push(calcCapFlex(As_B, dB, Mu_cap_B, 'B', reb.botBDia, reb.botBSpacing))
  const Mu_cap_L = P_max * geom.nCol / geom.B * L_cant_L
  items.push(calcCapFlex(As_L, dL, Mu_cap_L, 'L', reb.botLDia, reb.botLSpacing))

  // ── 4. 기초 캡 전단 (말뚝 반력에 의한 1방향) ─────────────────
  const d_s = Math.min(dB, dL)
  const Vc_cap = (lambda / 6) * Math.sqrt(fck) * 1000 * d_s / 1000
  const phiVc_cap = phi_shear * Vc_cap
  const Vu_cap = q_cap_B * Math.max(L_cant_B - d_s / 1000, 0)
  const ok_v = phiVc_cap >= Vu_cap
  {
    const steps: CalcLine[] = [
      sec('■ 기초 캡 전단강도 (KDS 14 20 22)'),
      ln(`Vu = P_말뚝 × (L_cant - d)`, `${Vu_cap.toFixed(1)} kN/m`),
      ln(`Vc = (λ/6)·√fck·b·d = (${lambda}/6)×√${fck}×1000×${d_s.toFixed(0)}/1000`, `${Vc_cap.toFixed(1)} kN/m`),
      ln(`φVc`, `${phiVc_cap.toFixed(1)} kN/m`, 0, 'result'),
      verdict(ok_v, Vu_cap, phiVc_cap, 'kN/m'),
    ]
    if (!ok_v) warns.push('기초 캡 전단강도 부족')
    items.push({
      id: 'cap-shear', label: '기초 캡 전단', demandSymbol: 'Vu', capacitySymbol: 'φVc',
      demand: Vu_cap, capacity: phiVc_cap, unit: 'kN/m',
      SF: phiVc_cap / Vu_cap, ratio: Vu_cap / phiVc_cap,
      status: ok_v ? 'OK' : 'NG',
      formula: 'Vu ≤ φVc = φ(λ/6)√fck·b·d',
      detail: {}, steps,
    })
  }

  const overallStatus: CheckStatus = items.some(i => i.status === 'NG')
    ? 'NG' : items.some(i => i.status === 'WARN') ? 'WARN' : 'OK'
  return { moduleId: 'foundation', items, overallStatus, maxRatio: Math.max(...items.map(i => i.ratio)), warnings: warns }
}

// ── SVG 직접기초 단면도 ──────────────────────────────────────────
function SpreadDiagram({ geom, reb }: { geom: SpreadGeom; reb: FootRebar }) {
  const W = 500; const H = 380
  const pad = { l: 70, r: 60, t: 50, b: 50 }
  const dw = W - pad.l - pad.r; const dh = H - pad.t - pad.b

  const totalW = geom.B + 1.0; const totalH = geom.D + 0.5
  const sx = dw / totalW; const sy = dh / totalH
  const ox = pad.l; const oy = pad.t

  const tx = (x: number) => ox + x * sx
  const ty = (y: number) => oy + y * sy

  const footTop = geom.D - geom.t / 1000
  const colW = geom.colB / 1000
  const colX = geom.B / 2 - colW / 2

  const dimColor = '#1a56b0'
  const COV = reb.cover / 1000

  const barY = ty(footTop + geom.t / 1000 - COV - reb.botBDia / 2000)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fff' }}>
      <defs>
        <marker id="arrF" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={dimColor}/>
        </marker>
        <marker id="arrFR" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto-start-reverse">
          <path d="M0,0 L6,3 L0,6 Z" fill={dimColor}/>
        </marker>
        <pattern id="hatchF" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#8b6914" strokeWidth="1.2" strokeOpacity="0.35"/>
        </pattern>
      </defs>

      <text x={W/2} y={22} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1e2a3a">
        직접기초 단면도 (B방향, 단위폭)
      </text>

      {/* 지반 */}
      <rect x={ox} y={ty(0)} width={dw} height={ty(footTop)-ty(0)}
        fill="url(#hatchF)" opacity={0.5}/>
      {/* 기초판 */}
      <rect x={tx(0)} y={ty(footTop)} width={geom.B*sx} height={(geom.t/1000)*sy}
        fill="#e8eef6" stroke="#2c3e70" strokeWidth="1.5"/>
      {/* 기둥 단면 (상부) */}
      <rect x={tx(colX)} y={ty(0)} width={colW*sx} height={footTop*sy}
        fill="#d0d8eb" stroke="#2c3e70" strokeWidth="1.5"/>

      {/* 지표면 */}
      <line x1={ox} y1={ty(0)} x2={ox+dw} y2={ty(0)} stroke="#6b4f1a" strokeWidth="2"/>
      <text x={ox+4} y={ty(0)-4} fontSize="8" fill="#6b4f1a">G.L.</text>

      {/* 수직 반력 */}
      {[0.3, 0.5, 0.7].map((f, i) => (
        <line key={i}
          x1={tx(f * geom.B)} y1={ty(footTop + geom.t/1000) + 22}
          x2={tx(f * geom.B)} y2={ty(footTop + geom.t/1000) + 4}
          stroke="#1a7a3c" strokeWidth="1.5" markerEnd="url(#arrF)"/>
      ))}
      <text x={tx(geom.B/2)} y={ty(footTop + geom.t/1000)+36}
        textAnchor="middle" fontSize="8" fill="#1a7a3c">지반반력 q</text>

      {/* 기둥 하중 */}
      <line x1={tx(geom.B/2)} y1={ty(0)-28} x2={tx(geom.B/2)} y2={ty(0)-4}
        stroke="#c0392b" strokeWidth="2" markerEnd="url(#arrF)"/>
      <text x={tx(geom.B/2)} y={ty(0)-30} textAnchor="middle" fontSize="8" fill="#c0392b">P, M</text>

      {/* 하단 주철근 */}
      <line x1={tx(0)+COV*sx} y1={barY} x2={tx(geom.B)-COV*sx} y2={barY}
        stroke="#c0392b" strokeWidth={Math.max(2, reb.botBDia/8)} strokeLinecap="round"/>

      {/* 위험단면 (기둥면) */}
      <line x1={tx(colX)} y1={ty(footTop)-4} x2={tx(colX)} y2={ty(footTop + geom.t/1000)+4}
        stroke="#e74c3c" strokeWidth="1" strokeDasharray="4,2"/>
      <line x1={tx(colX+colW)} y1={ty(footTop)-4} x2={tx(colX+colW)} y2={ty(footTop + geom.t/1000)+4}
        stroke="#e74c3c" strokeWidth="1" strokeDasharray="4,2"/>
      <text x={tx(colX)-2} y={ty(footTop)-6} fontSize="7" fill="#e74c3c" textAnchor="end">위험단면</text>

      {/* 치수: B */}
      <line x1={tx(0)} y1={oy-16} x2={tx(geom.B)} y2={oy-16}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrFR)" markerEnd="url(#arrF)"/>
      <text x={tx(geom.B/2)} y={oy-18} textAnchor="middle" fontSize="9" fill={dimColor}>B = {geom.B}m</text>

      {/* 치수: t */}
      <line x1={ox-20} y1={ty(footTop)} x2={ox-20} y2={ty(footTop+geom.t/1000)}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrFR)" markerEnd="url(#arrF)"/>
      <text x={ox-22} y={ty(footTop + geom.t/2000)} textAnchor="end" fontSize="9" fill={dimColor}>t={geom.t}mm</text>

      {/* 치수: D */}
      <line x1={ox-40} y1={ty(0)} x2={ox-40} y2={ty(geom.D)}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrFR)" markerEnd="url(#arrF)"/>
      <text x={ox-42} y={ty(geom.D/2)} textAnchor="end" fontSize="9" fill={dimColor}>D={geom.D}m</text>

      {/* 철근 범례 */}
      <g transform={`translate(${W-120}, ${pad.t+10})`}>
        <rect width="112" height="42" fill="white" stroke="#ccc" strokeWidth="0.8" rx="2"/>
        <line x1="5" y1="20" x2="20" y2="20" stroke="#c0392b" strokeWidth="2.5"/>
        <text x="24" y="23" fontSize="8" fill="#333">D{reb.botBDia}@{reb.botBSpacing} (B방향)</text>
        <line x1="5" y1="34" x2="20" y2="34" stroke="#2980b9" strokeWidth="2"/>
        <text x="24" y="37" fontSize="8" fill="#333">D{reb.botLDia}@{reb.botLSpacing} (L방향)</text>
      </g>

      <text x={pad.l} y={H-8} fontSize="7.5" fill="#888">
        KDS 14 20 00 : 2025 / KDS 11 50 15 / 도로설계편람 교량편
      </text>
    </svg>
  )
}

// ── SVG 말뚝기초 평면도 + 단면도 ────────────────────────────────
function PileDiagram({ geom }: { geom: PileGeom }) {
  const W = 500; const H = 440
  // 상단: 평면도 / 하단: 단면도
  const planH = 200; const secH = 210
  const pad = { l: 60, r: 40, t: 40, b: 30 }

  const planW = W - pad.l - pad.r
  const dimColor = '#1a56b0'

  // 평면도 스케일
  const maxDim = Math.max(geom.B, geom.L) + 0.6
  const scale = Math.min(planW / maxDim, planH / maxDim)
  const ox = pad.l + planW / 2  // 평면 중심
  const oy = pad.t + planH / 2

  // 말뚝 위치 (평면)
  const piles: { x: number; y: number }[] = []
  for (let r = 0; r < geom.nRow; r++) {
    for (let c = 0; c < geom.nCol; c++) {
      piles.push({
        x: ox + (c - (geom.nCol - 1) / 2) * geom.pileSpacing * scale,
        y: oy + (r - (geom.nRow - 1) / 2) * geom.pileSpacing * scale,
      })
    }
  }

  const capHalfW = (geom.B / 2) * scale
  const capHalfL = (geom.L / 2) * scale
  const pileR = (geom.pileDia / 2000) * scale

  // 단면도 (정면, B방향)
  const sy2 = pad.t + planH + 14
  const secScale = Math.min(planW / (geom.B + 1), secH / (geom.pileLen + geom.t / 1000 + 1))
  const sox = pad.l + planW / 2
  const soy = sy2 + 10

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fff' }}>
      <defs>
        <marker id="arrP" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={dimColor}/>
        </marker>
        <marker id="arrPR" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto-start-reverse">
          <path d="M0,0 L6,3 L0,6 Z" fill={dimColor}/>
        </marker>
        <pattern id="hatchP" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#8b6914" strokeWidth="1.2" strokeOpacity="0.35"/>
        </pattern>
      </defs>

      {/* 제목 */}
      <text x={W/2} y={18} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1e2a3a">
        말뚝기초 평면도 / 단면도
      </text>
      <text x={pad.l} y={pad.t-4} fontSize="9" fill="#555" fontWeight="600">[ 평면도 ]</text>

      {/* 기초 캡 외곽 */}
      <rect x={ox-capHalfW} y={oy-capHalfL} width={2*capHalfW} height={2*capHalfL}
        fill="#e8eef6" stroke="#2c3e70" strokeWidth="1.5" fillOpacity="0.7"/>

      {/* 기둥 단면 */}
      <rect
        x={ox - (geom.colB/2000)*scale} y={oy - (geom.colL/2000)*scale}
        width={(geom.colB/1000)*scale} height={(geom.colL/1000)*scale}
        fill="#c0cadf" stroke="#2c3e70" strokeWidth="1"/>

      {/* 말뚝 (평면) */}
      {piles.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={pileR} fill="white" stroke="#1a56b0" strokeWidth="1.5"/>
          <circle cx={p.x} cy={p.y} r={1.5} fill="#1a56b0"/>
          <text x={p.x} y={p.y-pileR-2} textAnchor="middle" fontSize="7" fill="#1a56b0">P{i+1}</text>
        </g>
      ))}

      {/* 말뚝 간격 치수 (평면) */}
      {geom.nCol >= 2 && (
        <>
          <line x1={piles[0].x} y1={oy+capHalfL+8} x2={piles[1].x} y2={oy+capHalfL+8}
            stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrPR)" markerEnd="url(#arrP)"/>
          <text x={(piles[0].x+piles[1].x)/2} y={oy+capHalfL+20}
            textAnchor="middle" fontSize="8" fill={dimColor}>{geom.pileSpacing}m</text>
        </>
      )}
      {/* 캡 폭 */}
      <line x1={ox-capHalfW} y1={oy-capHalfL-12} x2={ox+capHalfW} y2={oy-capHalfL-12}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrPR)" markerEnd="url(#arrP)"/>
      <text x={ox} y={oy-capHalfL-20} textAnchor="middle" fontSize="8" fill={dimColor}>B={geom.B}m</text>

      {/* 구분선 */}
      <line x1={pad.l} y1={sy2} x2={W-pad.r} y2={sy2} stroke="#ccc" strokeWidth="0.8" strokeDasharray="4,2"/>
      <text x={pad.l} y={sy2+10} fontSize="9" fill="#555" fontWeight="600">[ 단면도 (B방향) ]</text>

      {/* 단면도: 지반 */}
      <rect x={pad.l} y={soy+16} width={planW} height={secH-20}
        fill="url(#hatchP)" opacity={0.4}/>
      {/* GL */}
      <line x1={pad.l} y1={soy+16} x2={pad.l+planW} y2={soy+16}
        stroke="#6b4f1a" strokeWidth="2"/>
      <text x={pad.l+3} y={soy+14} fontSize="8" fill="#6b4f1a">G.L.</text>

      {/* 기초 캡 단면 */}
      const capDepth = (geom.t/1000)*secScale
      <rect
        x={sox - (geom.B/2)*secScale} y={soy+16 + geom.D*secScale}
        width={geom.B*secScale} height={(geom.t/1000)*secScale}
        fill="#e8eef6" stroke="#2c3e70" strokeWidth="1.5"/>

      {/* 말뚝 단면 (수직선) */}
      {Array.from({ length: geom.nCol }, (_, c) => {
        const px = sox + (c - (geom.nCol-1)/2)*geom.pileSpacing*secScale
        const py_top = soy+16 + geom.D*secScale + (geom.t/1000)*secScale
        const py_bot = soy+16 + geom.D*secScale + (geom.t/1000)*secScale + geom.pileLen*secScale
        return (
          <g key={c}>
            <rect x={px-(geom.pileDia/2000)*secScale} y={py_top}
              width={(geom.pileDia/1000)*secScale} height={geom.pileLen*secScale}
              fill="#b8c8df" stroke="#1a56b0" strokeWidth="1.2"/>
            {/* 말뚝 선단 마커 */}
            <line x1={px-(geom.pileDia/2000)*secScale-3} y1={py_bot}
              x2={px+(geom.pileDia/2000)*secScale+3} y2={py_bot}
              stroke="#1a56b0" strokeWidth="1.5"/>
          </g>
        )
      })}

      {/* 기둥 단면 */}
      <rect
        x={sox - (geom.colB/2000)*secScale} y={soy+16}
        width={(geom.colB/1000)*secScale} height={geom.D*secScale}
        fill="#c0cadf" stroke="#2c3e70" strokeWidth="1.2"/>

      {/* 기초 캡 두께 치수 */}
      <line x1={pad.l-16} y1={soy+16+geom.D*secScale} x2={pad.l-16} y2={soy+16+geom.D*secScale+(geom.t/1000)*secScale}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrPR)" markerEnd="url(#arrP)"/>
      <text x={pad.l-18} y={soy+16+geom.D*secScale+(geom.t/2000)*secScale}
        textAnchor="end" fontSize="8" fill={dimColor}>t={geom.t}mm</text>

      {/* 말뚝 길이 치수 */}
      <line x1={pad.l+planW+8} y1={soy+16+geom.D*secScale+(geom.t/1000)*secScale}
        x2={pad.l+planW+8} y2={soy+16+geom.D*secScale+(geom.t/1000)*secScale+geom.pileLen*secScale}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrPR)" markerEnd="url(#arrP)"/>
      <text x={pad.l+planW+10} y={soy+16+geom.D*secScale+(geom.t/2000)*secScale+geom.pileLen*secScale/2}
        fontSize="8" fill={dimColor}>L={geom.pileLen}m</text>

      {/* 말뚝 직경 라벨 */}
      <text x={sox} y={soy+16+geom.D*secScale+(geom.t/1000)*secScale+geom.pileLen*secScale/3}
        textAnchor="middle" fontSize="8" fill="#1a56b0">φ{geom.pileDia}</text>

      {/* 수직 하중 */}
      <line x1={sox} y1={soy+4} x2={sox} y2={soy+14}
        stroke="#c0392b" strokeWidth="2" markerEnd="url(#arrP)"/>
      <text x={sox} y={soy+3} textAnchor="middle" fontSize="8" fill="#c0392b">P, M, V</text>

      <text x={pad.l} y={H-6} fontSize="7.5" fill="#888">
        KDS 11 50 20 : 2021 / KDS 14 20 00 : 2025 / 도로설계편람 교량편
      </text>
    </svg>
  )
}

// ── 공통 스타일 ─────────────────────────────────────────────────
const S = {
  label: { fontSize: '0.72rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: '2px' } as React.CSSProperties,
  input: {
    width: '100%', padding: '0.25rem 0.4rem', fontSize: '0.8rem',
    border: '1px solid var(--border-dark)', borderRadius: '2px',
    background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.35rem' } as React.CSSProperties,
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginBottom: '0.35rem' } as React.CSSProperties,
  secTitle: {
    fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)',
    borderBottom: '1px solid var(--border-dark)', paddingBottom: '3px',
    marginBottom: '0.4rem', marginTop: '0.6rem',
    fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as React.CSSProperties,
}

function Field({ label, unit, value, onChange, min, step }: {
  label: string; unit?: string; value: number
  onChange: (v: number) => void; min?: number; step?: number
}) {
  return (
    <div>
      <div style={S.label}>{label}{unit ? ` (${unit})` : ''}</div>
      <input type="number" style={S.input} value={value} min={min ?? 0} step={step ?? 1}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}/>
    </div>
  )
}

// ── 메인 패널 ────────────────────────────────────────────────────
export default function FoundationPanel() {
  const { isDesktop } = useResponsive()
  const [tab, setTab] = useState<'input' | 'diagram' | 'result'>('diagram')
  const [foundType, setFoundType] = useState<FoundationType>('spread')

  const [mat, setMat]         = useState<FoundMaterial>(DEF_MAT)
  const [load, setLoad]       = useState<FoundLoad>(DEF_LOAD)
  const [spreadGeom, setSpreadGeom] = useState<SpreadGeom>(DEF_SPREAD_GEOM)
  const [spreadSoil, setSpreadSoil] = useState<SpreadSoil>(DEF_SPREAD_SOIL)
  const [pileGeom, setPileGeom]     = useState<PileGeom>(DEF_PILE_GEOM)
  const [footReb, setFootReb] = useState<FootRebar>(DEF_FOOT_REB)
  const [result, setResult]   = useState<CheckResult | null>(null)

  const m  = useCallback(<K extends keyof FoundMaterial>(k: K, v: FoundMaterial[K]) => setMat(p => ({ ...p, [k]: v })), [])
  const l  = useCallback(<K extends keyof FoundLoad>(k: K, v: FoundLoad[K]) => setLoad(p => ({ ...p, [k]: v })), [])
  const sg = useCallback(<K extends keyof SpreadGeom>(k: K, v: SpreadGeom[K]) => setSpreadGeom(p => ({ ...p, [k]: v })), [])
  const ss = useCallback(<K extends keyof SpreadSoil>(k: K, v: SpreadSoil[K]) => setSpreadSoil(p => ({ ...p, [k]: v })), [])
  const pg = useCallback(<K extends keyof PileGeom>(k: K, v: PileGeom[K]) => setPileGeom(p => ({ ...p, [k]: v })), [])
  const fr = useCallback(<K extends keyof FootRebar>(k: K, v: FootRebar[K]) => setFootReb(p => ({ ...p, [k]: v })), [])

  const handleCalc = () => {
    if (foundType === 'spread') setResult(calcSpread(spreadGeom, mat, spreadSoil, load, footReb))
    else setResult(calcPile(pileGeom, mat, load, footReb))
    if (!isDesktop) setTab('result')
  }

  const tabBtn = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} style={{
      padding: '0.25rem 0.8rem', fontSize: '0.75rem', fontWeight: tab === t ? 700 : 500,
      background: tab === t ? 'var(--primary)' : 'var(--surface-2)',
      color: tab === t ? '#fff' : 'var(--text-2)',
      border: '1px solid var(--border-dark)', borderRadius: '2px', cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
    }}>{label}</button>
  )

  const InputPanel = (
    <div style={{ padding: '0.6rem 0.75rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* 기초 타입 */}
      <div style={S.secTitle}>기초 형식</div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        {(['spread', 'pile'] as FoundationType[]).map(t => (
          <button key={t} onClick={() => { setFoundType(t); setResult(null) }} style={{
            flex: 1, padding: '0.3rem', fontSize: '0.78rem', fontWeight: foundType === t ? 700 : 500,
            background: foundType === t ? 'var(--primary-bg)' : 'var(--surface-2)',
            border: `1px solid ${foundType === t ? 'var(--primary)' : 'var(--border-dark)'}`,
            color: foundType === t ? 'var(--primary)' : 'var(--text-2)',
            borderRadius: '2px', cursor: 'pointer', fontFamily: 'var(--font-mono)',
          }}>
            {t === 'spread' ? '직접기초 (확대기초)' : '말뚝기초 (Pile)'}
          </button>
        ))}
      </div>

      {/* 재료 */}
      <div style={S.secTitle}>재료</div>
      <div style={S.row3}>
        <Field label="fck" unit="MPa" value={mat.fck} onChange={v => m('fck', v)}/>
        <Field label="fy" unit="MPa" value={mat.fy} onChange={v => m('fy', v)}/>
        <Field label="γc" unit="kN/m³" value={mat.gammaConcrete} onChange={v => m('gammaConcrete', v)}/>
      </div>

      {/* 하중 */}
      <div style={S.secTitle}>하중 (기둥/교각 하단)</div>
      <div style={S.row}>
        <Field label="사용 축력 P" unit="kN" value={load.P} onChange={v => l('P', v)}/>
        <Field label="계수 축력 Pu" unit="kN" value={load.Pu} onChange={v => l('Pu', v)}/>
      </div>
      <div style={S.row}>
        <Field label="사용 모멘트 M" unit="kN·m" value={load.M} onChange={v => l('M', v)}/>
        <Field label="계수 모멘트 Mu" unit="kN·m" value={load.Mu} onChange={v => l('Mu', v)}/>
      </div>
      <div style={S.row}>
        <Field label="사용 전단력 V" unit="kN" value={load.V} onChange={v => l('V', v)}/>
        <Field label="계수 전단력 Vu" unit="kN" value={load.Vu} onChange={v => l('Vu', v)}/>
      </div>

      {/* 직접기초 전용 */}
      {foundType === 'spread' && <>
        <div style={S.secTitle}>기초 제원 (직접기초)</div>
        <div style={S.row}>
          <Field label="기초판 폭 B" unit="m" value={spreadGeom.B} onChange={v => sg('B', v)} step={0.1}/>
          <Field label="기초판 길이 L" unit="m" value={spreadGeom.L} onChange={v => sg('L', v)} step={0.1}/>
        </div>
        <div style={S.row}>
          <Field label="근입 깊이 D" unit="m" value={spreadGeom.D} onChange={v => sg('D', v)} step={0.1}/>
          <Field label="기초판 두께 t" unit="mm" value={spreadGeom.t} onChange={v => sg('t', v)}/>
        </div>
        <div style={S.row}>
          <Field label="기둥(교각) 폭" unit="mm" value={spreadGeom.colB} onChange={v => sg('colB', v)}/>
          <Field label="기둥(교각) 길이" unit="mm" value={spreadGeom.colL} onChange={v => sg('colL', v)}/>
        </div>
        <div style={S.secTitle}>지반 조건</div>
        <div style={S.row}>
          <Field label="허용지지력 qa" unit="kPa" value={spreadSoil.qa} onChange={v => ss('qa', v)}/>
          <Field label="흙 단위중량" unit="kN/m³" value={spreadSoil.gammaS} onChange={v => ss('gammaS', v)} step={0.5}/>
        </div>
        <div style={{ marginBottom: '0.35rem' }}>
          <Field label="마찰계수 μ" value={spreadSoil.mu} onChange={v => ss('mu', v)} step={0.05}/>
        </div>
      </>}

      {/* 말뚝기초 전용 */}
      {foundType === 'pile' && <>
        <div style={S.secTitle}>기초 캡 제원</div>
        <div style={S.row}>
          <Field label="캡 폭 B" unit="m" value={pileGeom.B} onChange={v => pg('B', v)} step={0.1}/>
          <Field label="캡 길이 L" unit="m" value={pileGeom.L} onChange={v => pg('L', v)} step={0.1}/>
        </div>
        <div style={S.row}>
          <Field label="캡 두께 t" unit="mm" value={pileGeom.t} onChange={v => pg('t', v)}/>
          <Field label="근입 깊이 D" unit="m" value={pileGeom.D} onChange={v => pg('D', v)} step={0.1}/>
        </div>
        <div style={S.row}>
          <Field label="기둥 폭" unit="mm" value={pileGeom.colB} onChange={v => pg('colB', v)}/>
          <Field label="기둥 길이" unit="mm" value={pileGeom.colL} onChange={v => pg('colL', v)}/>
        </div>
        <div style={S.secTitle}>말뚝 제원</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>말뚝 종류</div>
            <select style={S.input} value={pileGeom.pileType}
              onChange={e => pg('pileType', e.target.value as PileType)}>
              <option value="PHC">PHC 말뚝</option>
              <option value="steel-pipe">강관말뚝</option>
              <option value="cast-in-place">현장타설말뚝</option>
              <option value="H-pile">H형강말뚝</option>
            </select>
          </div>
          <Field label="말뚝 직경" unit="mm" value={pileGeom.pileDia} onChange={v => pg('pileDia', v)}/>
        </div>
        <div style={S.row}>
          <Field label="말뚝 길이" unit="m" value={pileGeom.pileLen} onChange={v => pg('pileLen', v)} step={0.5}/>
          <Field label="말뚝 중심간격" unit="m" value={pileGeom.pileSpacing} onChange={v => pg('pileSpacing', v)} step={0.1}/>
        </div>
        <div style={S.row}>
          <Field label="행 수 (nRow)" value={pileGeom.nRow} onChange={v => pg('nRow', Math.max(1, Math.round(v)))}/>
          <Field label="열 수 (nCol)" value={pileGeom.nCol} onChange={v => pg('nCol', Math.max(1, Math.round(v)))}/>
        </div>
        <div style={S.secTitle}>말뚝 허용 지지력</div>
        <div style={S.row}>
          <Field label="연직 허용 Ra" unit="kN" value={pileGeom.Ra_single} onChange={v => pg('Ra_single', v)}/>
          <Field label="횡방향 허용 Ra" unit="kN" value={pileGeom.Ra_lateral} onChange={v => pg('Ra_lateral', v)}/>
        </div>
      </>}

      {/* 기초판 철근 */}
      <div style={S.secTitle}>기초판 철근</div>
      <div style={S.row}>
        <div>
          <div style={S.label}>B방향 하단 D</div>
          <select style={S.input} value={footReb.botBDia} onChange={e => fr('botBDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <Field label="B방향 간격" unit="mm" value={footReb.botBSpacing} onChange={v => fr('botBSpacing', v)}/>
      </div>
      <div style={S.row}>
        <div>
          <div style={S.label}>L방향 하단 D</div>
          <select style={S.input} value={footReb.botLDia} onChange={e => fr('botLDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <Field label="L방향 간격" unit="mm" value={footReb.botLSpacing} onChange={v => fr('botLSpacing', v)}/>
      </div>
      <div style={{ marginBottom: '0.5rem' }}>
        <Field label="피복 두께" unit="mm" value={footReb.cover} onChange={v => fr('cover', v)}/>
      </div>

      <button onClick={handleCalc} style={{
        width: '100%', padding: '0.5rem',
        background: 'var(--primary)', color: '#fff', border: 'none',
        borderRadius: '2px', fontSize: '0.82rem', fontWeight: 700,
        cursor: 'pointer', fontFamily: 'var(--font-mono)',
      }}>
        ▶ 검토 실행
      </button>
    </div>
  )

  const DiagramPanel = (
    <div style={{ padding: '0.5rem', background: '#fff', height: '100%', overflowY: 'auto' }}>
      {foundType === 'spread'
        ? <SpreadDiagram geom={spreadGeom} reb={footReb}/>
        : <PileDiagram geom={pileGeom}/>}
    </div>
  )

  if (isDesktop) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
        <div style={{ width: '22rem', minWidth: '22rem', borderRight: '1px solid var(--border-dark)', overflowY: 'auto' }}>
          {InputPanel}
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', padding: '0.5rem' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', marginBottom: '0.3rem', fontFamily: 'var(--font-mono)' }}>
            {foundType === 'spread' ? 'SPREAD FOUNDATION DIAGRAM' : 'PILE FOUNDATION DIAGRAM'}
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {DiagramPanel}
          </div>
        </div>
        <div style={{ width: '26rem', minWidth: '26rem', borderLeft: '1px solid var(--border-dark)', overflowY: 'auto' }}>
          {result
            ? <ResultTable items={result.items} overallStatus={result.overallStatus}/>
            : <div style={{ padding: '2rem', color: 'var(--text-3)', fontSize: '0.8rem', textAlign: 'center' }}>
                검토 실행 후 결과가 표시됩니다
              </div>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: '0.3rem', padding: '0.4rem 0.6rem', background: 'var(--surface-2)', borderBottom: '1px solid var(--border-dark)' }}>
        {tabBtn('input', '입력')}
        {tabBtn('diagram', '단면도')}
        {tabBtn('result', '결과')}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'input'   && InputPanel}
        {tab === 'diagram' && DiagramPanel}
        {tab === 'result'  && (result ? <ResultTable items={result.items} overallStatus={result.overallStatus}/> : <div style={{ padding: '2rem', color: 'var(--text-3)', fontSize: '0.8rem', textAlign: 'center' }}>검토 실행 후 결과가 표시됩니다</div>)}
      </div>
    </div>
  )
}
