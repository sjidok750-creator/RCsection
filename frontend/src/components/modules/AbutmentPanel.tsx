/**
 * AbutmentPanel.tsx
 * 교대 검토 (반중력식 / 역T형) + 기초 통합 검토
 * 적용기준: KDS 14 20 00:2025, KDS 11 50 15, KDS 11 50 20
 * 참고: 도로설계편람 교량편(국토교통부), 도로설계요령(2020) 제3권 교량
 */
import { useState, useCallback } from 'react'
import type { CheckResult, CheckItem, CalcLine, CheckStatus } from '../../types'
import { useResponsive } from '../../hooks/useResponsive'
import ResultTable from '../common/ResultTable'

// ── 상수 ─────────────────────────────────────────────────────────
const REBAR_AREA: Record<number, number> = {
  10: 71.3, 13: 126.7, 16: 198.6, 19: 286.5,
  22: 387.1, 25: 506.7, 29: 642.4, 32: 794.2, 35: 956.6,
}
const REBAR_DIAS = [10, 13, 16, 19, 22, 25, 29, 32, 35]

// ── 타입 정의 ─────────────────────────────────────────────────────
type AbutType = 'semi-gravity' | 'inverted-t'
type FoundType = 'spread' | 'pile'
type PileType = 'PHC' | 'steel-pipe' | 'cast-in-place' | 'H-pile'

// ─── 반중력식 교대 제원 ──────────────────────────────────────────
// 도면 기준: 전면이 계단+경사, 후면 직선
interface SemiGravityGeom {
  // 상부 치수 (상단부터)
  topWidth: number        // 교대 상단 전체폭 (m)  ex) 4.600
  backwallH: number       // 흉벽 높이 (m)         ex) 1.500
  backwallThick: number   // 흉벽 두께 (m)         ex) 0.400
  bearingPadW: number     // 교좌 돌출 폭 (m)      ex) 0.550
  // 줄기 (Stem) — 전면 경사+계단
  stemH: number           // 줄기 높이 (m)         ex) 6.000
  stemTopW: number        // 줄기 상단 두께 (m)    ex) 1.500(전면)+뒷면 직선
  stemBotW: number        // 줄기 하단 두께 (m)    ex) 3.500
  frontStepH: number      // 전면 계단 높이 (m)    ex) 1.000 (상단 수직부)
  frontStepW: number      // 전면 계단 폭 (m)      ex) 0.400
  // 기초판
  footH: number           // 기초판 두께 (m)       ex) 1.000
  footToe: number         // 앞굽 (m)              ex) 1.000
  footHeel: number        // 뒷굽 (m)              ex) 1.800
  footWidth: number       // 기초 전체폭 (m)       ex) 4.600
  // 뒷면 돌출 (계단)
  backStepH: number       // 뒷면 계단 높이 (m)    ex) 1.400
  backStepW: number       // 뒷면 계단 폭 (m)      ex) 0.200
  unitWidth: number       // 단위 폭 (m)
}

// ─── 역T형 교대 제원 ─────────────────────────────────────────────
// 도면 기준: 줄기 직선, 기초판 역T, 말뚝기초
interface InvertedTGeom {
  // 흉벽
  backwallH: number       // 흉벽 높이 (m)         ex) 0.880
  backwallThick: number   // 흉벽 두께 (m)         ex) 0.500
  // 교좌 블록
  bearingH: number        // 교좌 블록 높이 (m)    ex) 0.300(포함됨)
  bearingW: number        // 교좌 블록 폭 (m)      ex) 0.750
  // 줄기 (Stem) — 양면 직선, 상단/하단 두께
  stemH: number           // 줄기 높이 (m)         ex) 3.500
  stemTopW: number        // 줄기 상단 두께 (m)    ex) 0.500
  stemBotW: number        // 줄기 하단 두께 (m)    ex) 1.300 (기초 상면 폭)
  // 기초 헌치 (줄기 하단 돌출)
  haunchH: number         // 헌치 높이 (m)         ex) 1.000
  haunchW: number         // 헌치 폭 (양쪽, m)     ex) 1.300
  // 기초판
  footH: number           // 기초판 두께 (m)       ex) 1.820
  capH: number            // 기초 캡 두께 = footH  ex) 1.820
  footToe: number         // 앞굽 (m)              ex) 0.750 (0.100+0.650)
  footHeel: number        // 뒷굽 (m)              ex) 0.750 (0.650+0.100)
  footWidth: number       // 기초 전체폭 (m)       ex) 5.900
  sumpH: number           // 기초 하단 집수정 여유 (m) ex) 1.500 (기초 하부 돌출)
  unitWidth: number       // 단위 폭 (m)
}

// ─── 지반 / 토질 ─────────────────────────────────────────────────
interface SoilParam {
  gamma: number           // 흙 단위중량 (kN/m³)
  phi: number             // 내부마찰각 (°)
  c: number               // 점착력 (kPa)
  kaMode: 'auto' | 'manual'
  Ka: number              // 주동토압계수
  delta: number           // 벽마찰각 (°)
  qa: number              // 허용지지력 (kPa) — 직접기초
  muBase: number          // 기초 마찰계수
  // 말뚝 (역T형)
  Ra_vert: number         // 말뚝 연직 허용지지력 (kN/개)
  Ra_horiz: number        // 말뚝 횡방향 허용지지력 (kN/개)
  pileType: PileType
  pileDia: number         // 말뚝 직경 (mm)
  pileLen: number         // 말뚝 길이 (m)
  pileN: number           // 말뚝 수 (단위폭당)
  pileSpacing: number     // 말뚝 중심간격 (m)
}

// ─── 상부 하중 ───────────────────────────────────────────────────
interface AbutLoad {
  PDead: number           // 상부 고정하중 반력 (kN/m)
  PLive: number           // 상부 활하중 반력 (kN/m)
  braking: number         // 브레이킹 (kN/m)
  windH: number           // 풍하중 수평 (kN/m)
  tempH: number           // 온도·건조수축 (kN/m)
  surcharge: number       // 뒤채움 상재하중 (kPa)
  waterDepth: number      // 설계수위 (m)
  gammaWater: number      // 물 단위중량 (kN/m³)
}

// ─── 철근 ────────────────────────────────────────────────────────
interface AbutRebar {
  stemMainDia: number; stemMainSpacing: number
  stemShrinkDia: number;  stemShrinkSpacing: number
  stemCover: number
  footMainDia: number; footMainSpacing: number
  footCover: number
  bwMainDia: number; bwMainSpacing: number; bwCover: number
}

// ─── 재료 ────────────────────────────────────────────────────────
interface AbutMat {
  fck: number; fy: number; Es: number; gammaCon: number
}

// ════ 기본값 ══════════════════════════════════════════════════════
const DEF_SG: SemiGravityGeom = {
  topWidth: 4.600,
  backwallH: 1.500, backwallThick: 0.400, bearingPadW: 0.550,
  stemH: 6.000, stemTopW: 1.500, stemBotW: 3.500,
  frontStepH: 1.000, frontStepW: 0.400,
  footH: 1.000, footToe: 1.000, footHeel: 1.800, footWidth: 4.600,
  backStepH: 1.400, backStepW: 0.200,
  unitWidth: 1.0,
}
const DEF_IT: InvertedTGeom = {
  backwallH: 0.880, backwallThick: 0.500,
  bearingH: 0.300, bearingW: 0.750,
  stemH: 3.500, stemTopW: 0.500, stemBotW: 1.300,
  haunchH: 1.000, haunchW: 1.300,
  footH: 1.820, capH: 1.820,
  footToe: 0.750, footHeel: 0.750, footWidth: 5.900,
  sumpH: 1.500,
  unitWidth: 1.0,
}
const DEF_MAT: AbutMat = { fck: 27, fy: 400, Es: 200000, gammaCon: 24 }
const DEF_SOIL: SoilParam = {
  gamma: 18, phi: 30, c: 0, kaMode: 'auto', Ka: 0.333, delta: 20,
  qa: 300, muBase: 0.5,
  Ra_vert: 1200, Ra_horiz: 120,
  pileType: 'PHC', pileDia: 600, pileLen: 15, pileN: 3, pileSpacing: 1.80,
}
const DEF_LOAD: AbutLoad = {
  PDead: 450, PLive: 250, braking: 25, windH: 10, tempH: 15,
  surcharge: 10, waterDepth: 0, gammaWater: 10,
}
const DEF_REB: AbutRebar = {
  stemMainDia: 22, stemMainSpacing: 150, stemShrinkDia: 16, stemShrinkSpacing: 200, stemCover: 80,
  footMainDia: 22, footMainSpacing: 150, footCover: 80,
  bwMainDia: 16, bwMainSpacing: 200, bwCover: 70,
}

// ════ 계산 헬퍼 ═══════════════════════════════════════════════════
function calcKa(phi_deg: number) {
  const phi = (phi_deg * Math.PI) / 180
  return Math.tan(Math.PI / 4 - phi / 2) ** 2
}
function rebarAs(dia: number, spacing: number) {
  return ((REBAR_AREA[dia] ?? 0) / spacing) * 1000
}
function ln(t: string, v?: string, indent = 0, type: CalcLine['type'] = 'eq'): CalcLine {
  return { type, text: t, value: v, indent }
}
function sec(t: string): CalcLine { return { type: 'section', text: t } }
function verdict(ok: boolean, d: number, c: number, u: string): CalcLine {
  return { type: 'verdict', text: ok ? '✓ O.K.' : '✗ N.G.', value: `${d.toFixed(3)} / ${c.toFixed(3)} ${u} = ${(d/c).toFixed(3)}` }
}
function note(t: string): CalcLine { return { type: 'note', text: t } }

// ════ 반중력식 자중 분할 계산 ═════════════════════════════════════
interface WeightBlock { label: string; W: number; x: number } // W: kN/m, x: 앞굽 선단 기준

function sgWeightBlocks(g: SemiGravityGeom, mat: AbutMat): WeightBlock[] {
  const gc = mat.gammaCon
  const b: WeightBlock[] = []
  // 기초 앞굽 선단 = 원점 x=0
  // ① 기초판 전체 (직사각형)
  b.push({ label: '기초판', W: gc * g.footWidth * g.footH * g.unitWidth, x: g.footWidth / 2 })
  // ② 줄기 — 뒷면 직선, 전면 경사 (사다리꼴)
  // 줄기 뒷면 x 좌표 = footToe + stemBotW
  // 상단: x_L = footToe + (stemBotW - stemTopW), x_R = footToe + stemBotW
  // 뒷면 직선, 전면 경사 → 사다리꼴
  const stemArea = ((g.stemTopW + g.stemBotW) / 2) * g.stemH
  const xStemCentroid = g.footToe + g.stemBotW / 2  // 근사 (정확히는 무게중심)
  b.push({ label: '줄기 (사다리꼴)', W: gc * stemArea * g.unitWidth, x: xStemCentroid })
  // ③ 흉벽
  b.push({ label: '흉벽', W: gc * g.backwallThick * g.backwallH * g.unitWidth,
    x: g.footToe + g.stemBotW - g.backwallThick / 2 })
  // ④ 전면 계단 (추가 부분)
  b.push({ label: '전면 계단', W: gc * g.frontStepW * g.frontStepH * g.unitWidth,
    x: g.footToe - g.frontStepW / 2 })
  // ⑤ 뒷면 계단 (돌출)
  b.push({ label: '뒷면 돌출', W: gc * g.backStepW * g.backStepH * g.unitWidth,
    x: g.footToe + g.stemBotW + g.backStepW / 2 })
  return b
}

// ════ 역T형 자중 분할 계산 ═════════════════════════════════════════
function itWeightBlocks(g: InvertedTGeom, mat: AbutMat): WeightBlock[] {
  const gc = mat.gammaCon
  const b: WeightBlock[] = []
  // 기초 앞굽 선단 = 원점
  // ① 기초판 (직사각형, 전체폭×footH)
  b.push({ label: '기초 캡', W: gc * g.footWidth * g.footH * g.unitWidth, x: g.footWidth / 2 })
  // ② 줄기 (사다리꼴 — 상단 좁고 하단 넓음)
  const stemArea = ((g.stemTopW + g.stemBotW) / 2) * g.stemH
  const xStemC = g.footToe + g.haunchW + g.stemBotW / 2  // 줄기 중심 (근사)
  b.push({ label: '줄기', W: gc * stemArea * g.unitWidth, x: xStemC })
  // ③ 헌치 (좌우 삼각형)
  const haunchArea = 0.5 * g.haunchW * g.haunchH * 2  // 양쪽
  b.push({ label: '헌치', W: gc * haunchArea * g.unitWidth,
    x: g.footToe + g.haunchW / 2 + g.stemBotW / 2 + g.haunchW / 2 })
  // ④ 흉벽
  const xBw = g.footToe + g.haunchW + (g.stemBotW - g.backwallThick) / 2
  b.push({ label: '흉벽', W: gc * g.backwallThick * g.backwallH * g.unitWidth, x: xBw })
  return b
}

// ════ 공통 안정·단면 검토 ════════════════════════════════════════
function calcStability(
  Wblocks: WeightBlock[],
  soilW: number, soilX: number,   // 뒤채움 자중
  superW: number, superX: number,  // 상부하중
  Ea_tri: number, yTri: number,
  Ea_sur: number, ySur: number,
  Ea_water: number, yWater: number,
  H_ext: number, hExt: number,    // 브레이킹 등 외부수평, 작용높이
  footWidth: number,
  soil: SoilParam,
  _mat: AbutMat,
  foundType: FoundType,
  items: CheckItem[], warns: string[],
) {
  const V_con = Wblocks.reduce((s, b) => s + b.W, 0)
  const Mr_con = Wblocks.reduce((s, b) => s + b.W * b.x, 0)
  const V_soil = soilW
  const V_super = superW
  const V_total = V_con + V_soil + V_super
  const Mr_total = Mr_con + V_soil * soilX + V_super * superX

  const Ea_total = Ea_tri + Ea_sur + Ea_water
  const Mo = Ea_tri * yTri + Ea_sur * ySur + Ea_water * yWater + H_ext * hExt
  const H_total = Ea_total + H_ext

  // ── 전도 F.S. ≥ 2.0 ──
  const FS_ot = Mr_total / Mo
  const ok_ot = FS_ot >= 2.0
  if (!ok_ot) warns.push('전도 안정 F.S. < 2.0')
  items.push({
    id: 'overturning', label: '전도 안정', demandSymbol: 'Mo', capacitySymbol: 'Mr/2',
    demand: Mo, capacity: Mr_total / 2, unit: 'kN·m/m',
    SF: FS_ot, ratio: 1 / FS_ot * 2,
    status: ok_ot ? 'OK' : 'NG',
    formula: 'F.S. = Mr / Mo ≥ 2.0 (KDS 11 50 15)',
    detail: {},
    steps: [
      sec('■ 전도 안정 검토'),
      ln(`수직 합력 ΣV = ${V_total.toFixed(1)} kN/m`),
      ln(`저항 모멘트 Mr = ${Mr_total.toFixed(1)} kN·m/m`),
      ln(`전도 모멘트 Mo = ${Mo.toFixed(1)} kN·m/m`),
      ln(`F.S. = Mr / Mo`, `${FS_ot.toFixed(3)}`, 0, 'result'),
      verdict(ok_ot, Mo, Mr_total / 2, 'kN·m/m'),
    ],
  })

  // ── 활동 F.S. ≥ 1.5 ──
  const Hr = V_total * soil.muBase
  const FS_sl = Hr / H_total
  const ok_sl = FS_sl >= 1.5
  if (!ok_sl) warns.push('활동 안정 F.S. < 1.5')
  items.push({
    id: 'sliding', label: '활동 안정', demandSymbol: 'ΣH', capacitySymbol: 'μ·ΣV/1.5',
    demand: H_total, capacity: Hr / 1.5, unit: 'kN/m',
    SF: FS_sl, ratio: H_total / (Hr / 1.5),
    status: ok_sl ? 'OK' : 'NG',
    formula: 'F.S. = μ·ΣV / ΣH ≥ 1.5',
    detail: {},
    steps: [
      sec('■ 활동 안정 검토'),
      ln(`저항력 Hr = μ·ΣV = ${soil.muBase}×${V_total.toFixed(1)}`, `${Hr.toFixed(1)} kN/m`),
      ln(`수평 합력 ΣH`, `${H_total.toFixed(1)} kN/m`),
      ln(`F.S.`, `${FS_sl.toFixed(3)}`, 0, 'result'),
      verdict(ok_sl, H_total, Hr / 1.5, 'kN/m'),
    ],
  })

  // ── 지반 지지력 (직접기초) ──
  if (foundType === 'spread') {
    const xbar = (Mr_total - Mo) / V_total
    const e = footWidth / 2 - xbar
    const Beff = Math.max(footWidth - 2 * Math.abs(e), 0.1)
    const q_max = V_total / Beff
    const ok_bc = q_max <= soil.qa
    if (!ok_bc) warns.push('지반 지지력 초과')
    if (Math.abs(e) > footWidth / 6) warns.push(`편심 e=${e.toFixed(3)}m > B/6`)
    items.push({
      id: 'bearing', label: '지반 지지력', demandSymbol: 'q_max', capacitySymbol: 'qa',
      demand: q_max, capacity: soil.qa, unit: 'kPa',
      SF: soil.qa / q_max, ratio: q_max / soil.qa,
      status: ok_bc ? 'OK' : 'NG',
      formula: 'q_max = ΣV/B\' ≤ qa',
      detail: {},
      steps: [
        sec('■ 지반 지지력 검토 (KDS 11 50 15)'),
        ln(`편심 e = B/2 - (Mr-Mo)/ΣV`, `${e.toFixed(3)} m`),
        Math.abs(e) > footWidth/6 ? verdict(false, Math.abs(e), footWidth/6, 'm') : note(`e ≤ B/6 ✓`),
        ln(`유효폭 B' = B - 2e`, `${Beff.toFixed(3)} m`),
        ln(`q_max = ΣV/B'`, `${q_max.toFixed(1)} kPa`, 0, 'result'),
        verdict(ok_bc, q_max, soil.qa, 'kPa'),
      ],
    })
  }
}

// ════ 단면 검토 (전면벽 휨/전단, 기초판 휨) ═══════════════════════
function calcSection(
  stemH: number, footHeel: number, footH: number,
  _Ka: number, _soil: SoilParam, load: AbutLoad, mat: AbutMat, reb: AbutRebar,
  Ea_tri: number, Ea_sur: number, H_ext: number,
  items: CheckItem[], warns: string[],
) {
  const { fck, fy, gammaCon } = mat
  const phi_f = 0.85, phi_v = 0.75, lam = 1.0
  const b = 1000 // mm/m

  // ── 전면벽 휨 (기초상면 위험단면) ──
  const d_s = stemH * 1000 - reb.stemCover - reb.stemMainDia / 2  // mm
  const Mu_s = (Ea_tri * stemH / 3 + Ea_sur * stemH / 2 + H_ext * stemH / 2)  // kN·m/m
  const As_s = rebarAs(reb.stemMainDia, reb.stemMainSpacing)
  const a_s = As_s * fy / (0.85 * fck * b)
  const phiMn_s = phi_f * As_s * fy * (d_s - a_s / 2) / 1e6
  const ok_sf = phiMn_s >= Mu_s
  if (!ok_sf) warns.push('전면벽 휨 강도 부족')
  items.push({
    id: 'stem-flex', label: '전면벽 휨강도', demandSymbol: 'Mu', capacitySymbol: 'φMn',
    demand: Mu_s, capacity: phiMn_s, unit: 'kN·m/m',
    SF: phiMn_s / Mu_s, ratio: Mu_s / phiMn_s,
    status: ok_sf ? 'OK' : 'NG',
    formula: 'Mu = Ea·H/3 + Ea_q·H/2 ≤ φMn',
    detail: {},
    steps: [
      sec('■ 전면벽 휨강도 (KDS 14 20 20)'),
      note('위험단면: 기초 상면'),
      ln(`Mu`, `${Mu_s.toFixed(1)} kN·m/m`),
      ln(`As = D${reb.stemMainDia}@${reb.stemMainSpacing}`, `${As_s.toFixed(0)} mm²/m`),
      ln(`d`, `${d_s.toFixed(0)} mm`),
      ln(`φMn`, `${phiMn_s.toFixed(1)} kN·m/m`, 0, 'result'),
      verdict(ok_sf, Mu_s, phiMn_s, 'kN·m/m'),
    ],
  })

  // ── 전면벽 전단 ──
  const Vu_s = Ea_tri + Ea_sur + H_ext
  const Vc_s = (lam / 6) * Math.sqrt(fck) * b * d_s / 1000
  const phiVc_s = phi_v * Vc_s
  const ok_sv = phiVc_s >= Vu_s
  if (!ok_sv) warns.push('전면벽 전단 강도 부족')
  items.push({
    id: 'stem-shear', label: '전면벽 전단강도', demandSymbol: 'Vu', capacitySymbol: 'φVc',
    demand: Vu_s, capacity: phiVc_s, unit: 'kN/m',
    SF: phiVc_s / Vu_s, ratio: Vu_s / phiVc_s,
    status: ok_sv ? 'OK' : 'NG',
    formula: 'Vu ≤ φVc = φ(λ/6)√fck·b·d',
    detail: {},
    steps: [
      sec('■ 전면벽 전단강도 (KDS 14 20 22)'),
      ln(`Vu`, `${Vu_s.toFixed(1)} kN/m`),
      ln(`φVc`, `${phiVc_s.toFixed(1)} kN/m`, 0, 'result'),
      verdict(ok_sv, Vu_s, phiVc_s, 'kN/m'),
    ],
  })

  // ── 뒷굽 기초판 휨 ──
  const d_h = footH * 1000 - reb.footCover - reb.footMainDia / 2
  const q_avg = (load.PDead + load.PLive) / footHeel  // 근사 (단위 kN/m²)
  const w_self = gammaCon * footH
  const Mu_h = Math.max((q_avg - w_self) * footHeel ** 2 / 2, 0)
  const As_h = rebarAs(reb.footMainDia, reb.footMainSpacing)
  const a_h = As_h * fy / (0.85 * fck * b)
  const phiMn_h = phi_f * As_h * fy * (d_h - a_h / 2) / 1e6
  const ok_hf = phiMn_h >= Mu_h
  if (!ok_hf) warns.push('뒷굽 기초판 휨 강도 부족')
  items.push({
    id: 'heel-flex', label: '뒷굽 기초판 휨', demandSymbol: 'Mu', capacitySymbol: 'φMn',
    demand: Mu_h, capacity: phiMn_h, unit: 'kN·m/m',
    SF: phiMn_h / Mu_h || 999, ratio: Mu_h / phiMn_h || 0,
    status: ok_hf ? 'OK' : 'NG',
    formula: 'Mu = q_net·L²/2 ≤ φMn',
    detail: {},
    steps: [
      sec('■ 뒷굽 기초판 휨강도 (KDS 14 20 20)'),
      ln(`뒷굽 L = ${footHeel.toFixed(3)} m`),
      ln(`Mu`, `${Mu_h.toFixed(1)} kN·m/m`),
      ln(`φMn`, `${phiMn_h.toFixed(1)} kN·m/m`, 0, 'result'),
      verdict(ok_hf, Mu_h, phiMn_h, 'kN·m/m'),
    ],
  })
}

// ════ 말뚝 지지력 (역T형) ═════════════════════════════════════════
function calcPileCheck(
  soil: SoilParam, V_total: number, H_total: number, M_total: number,
  items: CheckItem[], warns: string[],
) {
  const { pileN, pileSpacing, Ra_vert, Ra_horiz } = soil
  const n = pileN
  // 단순 등간격 배치 (1열 기준)
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pileSpacing)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)
  const P_max = V_total / n + (M_total * Math.max(...xs.map(Math.abs))) / (sumX2 || 1)
  const ok_pv = P_max <= Ra_vert
  if (!ok_pv) warns.push('말뚝 연직 지지력 초과')
  items.push({
    id: 'pile-vert', label: '말뚝 연직 지지력', demandSymbol: 'P_max', capacitySymbol: 'Ra',
    demand: P_max, capacity: Ra_vert, unit: 'kN',
    SF: Ra_vert / P_max, ratio: P_max / Ra_vert,
    status: ok_pv ? 'OK' : 'NG',
    formula: 'P_max = ΣV/n + M·x/Σxi² ≤ Ra',
    detail: {},
    steps: [
      sec('■ 말뚝 연직 지지력 (KDS 11 50 20)'),
      ln(`말뚝 수 n`, `${n}개`),
      ln(`Σxi²`, `${sumX2.toFixed(3)} m²`),
      ln(`P_max = ${V_total.toFixed(1)}/${n} + ${M_total.toFixed(1)}×${Math.max(...xs.map(Math.abs)).toFixed(3)}/${sumX2.toFixed(3)}`, `${P_max.toFixed(1)} kN`, 0, 'result'),
      verdict(ok_pv, P_max, Ra_vert, 'kN'),
    ],
  })
  const H_per = H_total / n
  const ok_ph = H_per <= Ra_horiz
  if (!ok_ph) warns.push('말뚝 횡방향 지지력 초과')
  items.push({
    id: 'pile-horiz', label: '말뚝 횡방향 지지력', demandSymbol: 'H/n', capacitySymbol: 'Ra_lat',
    demand: H_per, capacity: Ra_horiz, unit: 'kN',
    SF: Ra_horiz / H_per, ratio: H_per / Ra_horiz,
    status: ok_ph ? 'OK' : 'NG',
    formula: 'H/n ≤ Ra_lat',
    detail: {},
    steps: [
      sec('■ 말뚝 횡방향 지지력'),
      ln(`H/n = ${H_total.toFixed(1)}/${n}`, `${H_per.toFixed(1)} kN`, 0, 'result'),
      verdict(ok_ph, H_per, Ra_horiz, 'kN'),
    ],
  })
}

// ════ 메인 검토 함수 ══════════════════════════════════════════════
function calcAbutSG(sg: SemiGravityGeom, mat: AbutMat, soil: SoilParam, load: AbutLoad, reb: AbutRebar, foundType: FoundType): CheckResult {
  const items: CheckItem[] = []; const warns: string[] = []
  const Ka = soil.kaMode === 'auto' ? calcKa(soil.phi) : soil.Ka
  const H_total = sg.stemH + sg.backwallH + sg.footH  // 전체 높이 (기초 하면~흉벽 상면)

  const Ea_tri  = 0.5 * soil.gamma * Ka * H_total ** 2
  const Ea_sur  = load.surcharge * Ka * H_total
  const Ea_wat  = load.waterDepth > 0 ? 0.5 * load.gammaWater * load.waterDepth ** 2 : 0
  const H_ext   = load.braking + load.windH + load.tempH

  const Wblocks = sgWeightBlocks(sg, mat)

  // 뒤채움 토압
  const soilW = soil.gamma * sg.footHeel * (sg.stemH + sg.backwallH) * sg.unitWidth
  const soilX = sg.footToe + sg.stemBotW + sg.footHeel / 2

  // 상부하중
  const superW = (load.PDead + load.PLive) * sg.unitWidth
  const superX = sg.footToe + sg.stemBotW - sg.backwallThick / 2

  calcStability(
    Wblocks, soilW, soilX, superW, superX,
    Ea_tri, H_total / 3, Ea_sur, H_total / 2, Ea_wat, load.waterDepth / 3,
    H_ext, sg.stemH / 2,
    sg.footWidth, soil, mat, foundType, items, warns,
  )
  calcSection(sg.stemH, sg.footHeel, sg.footH, Ka, soil, load, mat, reb, Ea_tri, Ea_sur, H_ext, items, warns)

  const os: CheckStatus = items.some(i => i.status === 'NG') ? 'NG' : items.some(i => i.status === 'WARN') ? 'WARN' : 'OK'
  return { moduleId: 'abutment', items, overallStatus: os, maxRatio: Math.max(...items.map(i => i.ratio)), warnings: warns }
}

function calcAbutIT(it: InvertedTGeom, mat: AbutMat, soil: SoilParam, load: AbutLoad, reb: AbutRebar, foundType: FoundType): CheckResult {
  const items: CheckItem[] = []; const warns: string[] = []
  const Ka = soil.kaMode === 'auto' ? calcKa(soil.phi) : soil.Ka
  const H_total = it.backwallH + it.stemH + it.haunchH + it.footH

  const Ea_tri = 0.5 * soil.gamma * Ka * H_total ** 2
  const Ea_sur = load.surcharge * Ka * H_total
  const Ea_wat = load.waterDepth > 0 ? 0.5 * load.gammaWater * load.waterDepth ** 2 : 0
  const H_ext  = load.braking + load.windH + load.tempH

  const Wblocks = itWeightBlocks(it, mat)
  const soilW = soil.gamma * it.footHeel * (it.stemH + it.backwallH) * it.unitWidth
  const soilX = it.footToe + it.haunchW + it.stemBotW + it.haunchW + it.footHeel / 2

  const superW = (load.PDead + load.PLive) * it.unitWidth
  const stemCenterX = it.footToe + it.haunchW + it.stemTopW / 2
  const superX = stemCenterX

  const Vblocks_total = Wblocks.reduce((s, b) => s + b.W, 0) + soilW + superW
  const Mr_total = Wblocks.reduce((s, b) => s + b.W * b.x, 0) + soilW * soilX + superW * superX
  const Mo = Ea_tri * H_total / 3 + Ea_sur * H_total / 2 + Ea_wat * load.waterDepth / 3 + H_ext * it.stemH / 2

  calcStability(
    Wblocks, soilW, soilX, superW, superX,
    Ea_tri, H_total / 3, Ea_sur, H_total / 2, Ea_wat, load.waterDepth / 3,
    H_ext, it.stemH / 2,
    it.footWidth, soil, mat, foundType, items, warns,
  )

  if (foundType === 'pile') {
    calcPileCheck(soil, Vblocks_total, (Ea_tri + Ea_sur + Ea_wat + H_ext), Math.abs(Mr_total - Mo), items, warns)
  }

  calcSection(it.stemH + it.haunchH, it.footHeel, it.footH, Ka, soil, load, mat, reb, Ea_tri, Ea_sur, H_ext, items, warns)

  const os: CheckStatus = items.some(i => i.status === 'NG') ? 'NG' : items.some(i => i.status === 'WARN') ? 'WARN' : 'OK'
  return { moduleId: 'abutment', items, overallStatus: os, maxRatio: Math.max(...items.map(i => i.ratio)), warnings: warns }
}

// ════════════════════════════════════════════════════════════════════
// SVG — 반중력식 교대  (도로설계편람 1.5절 삽도 기준)
//
// 좌표계: x=0 → 기초 앞굽 선단(좌), y=0 → 기초 하면
// 방향:   좌=전면(앞굽), 우=후면(뒷굽·뒤채움)
//
// 편람 형상:
//   ① 기초판: footToe(앞굽) + stemBotW(줄기하단) + footHeel(뒷굽)
//   ② 전면계단: 기초 상면에서 좌측으로 frontStepW 돌출, 높이 frontStepH
//   ③ 줄기 전면: 계단 상단(xStemBotL, yStepTop)에서
//               줄기 상단 전면(xStemTopL, yStemTop)까지 경사
//      xStemBotL = footToe  (계단 위부터 시작)
//      xStemTopL = footToe + (stemBotW - stemTopW)  (경사로 우측으로 이동)
//   ④ 줄기 후면: xStemBotR = xStemTopR = footToe + stemBotW  (수직)
//   ⑤ 흉벽: 줄기 상단 후면쪽에 위치
//      xBwR = footToe + stemBotW
//      xBwL = xBwR - backwallThick
//   ⑥ 뒤채움: 줄기 후면(xStemR) ~ 뒷굽 우단(xFootR), G.L.~기초 상면
// ════════════════════════════════════════════════════════════════════
function SemiGravityDiagram({ g }: { g: SemiGravityGeom }) {
  // ── 편람 반중력식 삽도 형상 ──
  // 좌=전면(앞굽), 우=후면(뒷굽+뒤채움)
  // 줄기 후면은 수직, 전면은 위로 갈수록 오른쪽(후면방향)으로 경사
  // 흉벽은 줄기 상단 우측(후면)에 위치
  // 전면계단: 기초 앞굽 좌측에서 위로 돌출
  //
  // 편람 치수 예: 기초폭=4.600, 앞굽=1.000, 줄기하단=1.600, 뒷굽=1.800+0.200(돌출)
  //              줄기높이=6.000, 상단폭=1.500(흉벽0.400포함), 흉벽높이=1.500
  //              전면계단: 폭0.400, 높이1.000

  const SVG_W = 560, SVG_H = 540
  const PAD = { l: 90, r: 72, t: 58, b: 62 }
  const DW = SVG_W - PAD.l - PAD.r
  const DH = SVG_H - PAD.t - PAD.b

  const totalH_m = g.footH + g.stemH + g.backwallH + 0.6
  const totalW_m = g.footWidth + 0.5
  const SX = DW / totalW_m
  const SY = DH / totalH_m

  const ox = PAD.l
  const oy = PAD.t + DH
  const tx = (xm: number) => ox + xm * SX
  const ty = (ym: number) => oy - ym * SY

  // 높이 레벨
  const yFoot    = g.footH
  const yStemTop = yFoot + g.stemH
  const yBwTop   = yStemTop + g.backwallH

  // ── X 좌표 정의 ──
  // 기초판
  const xFootL = 0               // 앞굽 좌단
  const xFootR = g.footWidth     // 뒷굽 우단

  // 줄기 하단 전면 = 앞굽폭
  const xStemBotL = g.footToe

  // 줄기 후면 (수직) = 앞굽 + 줄기하단폭
  // 편람에서 기초 하단: 앞굽1.000 + 줄기폭1.600 + 뒷굽1.800 = 4.400
  // 그러나 footWidth=4.600이면 footHeel = footWidth - footToe - stemBotW
  const xStemBotR = g.footToe + g.stemBotW   // 줄기 하단 후면 = 줄기 후면 (상하동일, 수직)
  const xStemR    = xStemBotR                 // alias

  // 줄기 상단 전면:
  // 편람에서 줄기 상단폭(흉벽포함) = 1.500, 흉벽폭 = 0.400
  // 줄기 상단 전면은 경사로 후면방향으로 이동:
  // xStemTopL = xStemBotL + (stemBotW - stemTopW)
  // 즉 하단에서 상단으로 갈수록 전면이 우측으로 이동 → 왼쪽 경사면
  const xStemTopL = xStemBotL + (g.stemBotW - g.stemTopW)
  // 줄기 상단 후면 = 줄기 후면 (수직)
  const xStemTopR = xStemR

  // 흉벽: 줄기 상단 후면(우측)에 위치
  // xBwR = 줄기 후면 = xStemR
  // xBwL = xBwR - backwallThick
  const xBwR = xStemR
  const xBwL = xBwR - g.backwallThick

  // 전면 계단: 기초 상면에서 앞굽 좌측으로 frontStepW 돌출
  // 계단 좌단 = footToe - frontStepW
  // (편람에서 기초 앞굽=1.000, 계단폭=0.400이면 계단좌단 = 0.600)
  const xStepL   = g.footToe - g.frontStepW
  const yStepTop = yFoot + g.frontStepH

  // 후면 돌출: 줄기 후면 우측으로 backStepW
  const xBackR   = xStemR + g.backStepW
  const yBackTop = yFoot + g.backStepH

  // ── 단면 폴리곤 ──
  // 편람 형상: 좌하→우하→우상(뒷굽)→후면돌출→줄기후면상단→흉벽→줄기상단전면→경사→계단→좌상→좌하
  const pts: [number, number][] = [
    [xFootL,    0],          // ① 기초 하면 좌
    [xFootR,    0],          // ② 기초 하면 우
    [xFootR,    yFoot],      // ③ 뒷굽 상면 우
    [xBackR,    yFoot],      // ④ 후면돌출 하단 우
    [xBackR,    yBackTop],   // ⑤ 후면돌출 상단 우
    [xStemR,    yBackTop],   // ⑥ 후면돌출 상단 좌 (줄기 후면)
    [xStemR,    yStemTop],   // ⑦ 줄기 후면 상단 (수직)
    [xBwR,      yStemTop],   // ⑧ 흉벽 후면 하단 (=⑦, xBwR=xStemR)
    [xBwR,      yBwTop],     // ⑨ 흉벽 후면 상단
    [xBwL,      yBwTop],     // ⑩ 흉벽 전면 상단
    [xBwL,      yStemTop],   // ⑪ 흉벽 전면 하단
    [xStemTopL, yStemTop],   // ⑫ 줄기 상단 전면 (경사 상단)
    [xStemBotL, yStepTop],   // ⑬ 경사 하단 = 계단 우상단
    [xStepL,    yStepTop],   // ⑭ 계단 좌상단
    [xStepL,    yFoot],      // ⑮ 계단 좌하단 (기초 상면)
    [xFootL,    yFoot],      // ⑯ 앞굽 상면 좌
  ]
  const polyStr = pts.map(([x, y]) => `${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join(' ')

  const DIM = '#1a56b0'
  const FILL = '#dce8f5'
  const STROKE = '#1e3a6e'

  const hDim = (x1: number, x2: number, ym: number, label: string, yOff = -15) => {
    const y = ty(ym) + yOff
    const cx = (tx(x1) + tx(x2)) / 2
    return (
      <g>
        <line x1={tx(x1)} y1={y} x2={tx(x2)} y2={y} stroke={DIM} strokeWidth="1.1"
          markerStart="url(#aR)" markerEnd="url(#aF)"/>
        <line x1={tx(x1)} y1={y-5} x2={tx(x1)} y2={y+5} stroke={DIM} strokeWidth="1"/>
        <line x1={tx(x2)} y1={y-5} x2={tx(x2)} y2={y+5} stroke={DIM} strokeWidth="1"/>
        <text x={cx} y={y-5} textAnchor="middle" fontSize="12" fontWeight="600" fill={DIM}>{label}</text>
      </g>
    )
  }
  const vDim = (xm: number, y1: number, y2: number, label: string, xOff: number) => {
    const x = tx(xm) + xOff
    const cy = (ty(y1) + ty(y2)) / 2
    const anchor = xOff < 0 ? 'end' : 'start'
    const lx = xOff < 0 ? x - 5 : x + 5
    return (
      <g>
        <line x1={x} y1={ty(y1)} x2={x} y2={ty(y2)} stroke={DIM} strokeWidth="1.1"
          markerStart="url(#aR)" markerEnd="url(#aF)"/>
        <line x1={x-5} y1={ty(y1)} x2={x+5} y2={ty(y1)} stroke={DIM} strokeWidth="1"/>
        <line x1={x-5} y1={ty(y2)} x2={x+5} y2={ty(y2)} stroke={DIM} strokeWidth="1"/>
        <text x={lx} y={cy+4} textAnchor={anchor} fontSize="12" fontWeight="600" fill={DIM}>{label}</text>
      </g>
    )
  }

  return (
    <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fff', display: 'block' }}>
      <defs>
        <marker id="aF" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill={DIM}/>
        </marker>
        <marker id="aR" markerWidth="7" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <path d="M7,0 L0,3.5 L7,7 Z" fill={DIM}/>
        </marker>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#8b6914" strokeWidth="1.4" strokeOpacity="0.5"/>
        </pattern>
      </defs>

      <text x={SVG_W/2} y={22} textAnchor="middle" fontSize="14" fontWeight="700" fill="#1e2a3a">반중력식 교대 단면도</text>
      <text x={SVG_W/2} y={37} textAnchor="middle" fontSize="10" fill="#666">(단위 : m)</text>

      {/* 기초 하부 지반 */}
      <rect x={tx(xFootL)-2} y={ty(0)} width={tx(xFootR)-tx(xFootL)+4} height={22}
        fill="url(#hatch)" opacity={0.5}/>
      <line x1={tx(xFootL)-2} y1={ty(0)} x2={tx(xFootR)+2} y2={ty(0)} stroke="#6b4f1a" strokeWidth="2"/>

      {/* 뒤채움: 줄기 후면(xStemR)~뒷굽(xFootR), G.L.(yStemTop)~기초상면(yFoot) */}
      <rect x={tx(xStemR)} y={ty(yStemTop)}
        width={tx(xFootR) - tx(xStemR)}
        height={ty(yFoot) - ty(yStemTop)}
        fill="url(#hatch)" opacity={0.5}/>

      {/* G.L. */}
      <line x1={tx(xStemR)-4} y1={ty(yStemTop)} x2={tx(xFootR)+32} y2={ty(yStemTop)}
        stroke="#555" strokeWidth="1.3" strokeDasharray="7,4"/>
      <text x={tx(xFootR)+34} y={ty(yStemTop)+5} fontSize="11" fontWeight="700" fill="#555">G.L.</text>

      {/* 교대 본체 */}
      <polygon points={polyStr} fill={FILL} stroke={STROKE} strokeWidth="2.2" strokeLinejoin="miter"/>

      {/* 교좌장치 블록 (흉벽 상면) */}
      <rect x={tx(xBwL)+2} y={ty(yBwTop)-14}
        width={Math.max(g.backwallThick*SX-4, 8)} height={12}
        fill="#6c8ebf" stroke="#3b5998" strokeWidth="1.2" rx="1"/>

      {/* 폭 치수 */}
      {hDim(xFootL, xFootR, 0, `${g.footWidth.toFixed(3)}`, ty(0)+46)}
      {hDim(xFootL, xStemBotL, yFoot, `${g.footToe.toFixed(3)}`)}
      {hDim(xStemBotL, xStemBotR, yFoot, `${g.stemBotW.toFixed(3)}`)}
      {hDim(xStemBotR, xFootR, yFoot, `${g.footHeel.toFixed(3)}`)}
      {hDim(xStemTopL, xStemTopR, yStemTop, `${g.stemTopW.toFixed(3)}`, -17)}
      {hDim(xBwL, xBwR, yBwTop, `${g.backwallThick.toFixed(3)}`, -17)}
      {hDim(xStepL, xStemBotL, yStepTop, `${g.frontStepW.toFixed(3)}`, -16)}

      {/* 우측 높이 치수 */}
      {vDim(xFootR, 0, yFoot, `${g.footH.toFixed(3)}`, 16)}
      {vDim(xFootR, yFoot, yStemTop, `${g.stemH.toFixed(3)}`, 16)}
      {vDim(xFootR, yStemTop, yBwTop, `${g.backwallH.toFixed(3)}`, 16)}

      {/* 좌측 높이 치수 */}
      {vDim(xFootL, yFoot, yStepTop, `${g.frontStepH.toFixed(3)}`, -54)}
      {vDim(xFootL, 0, yStemTop, `${(g.footH+g.stemH).toFixed(3)}`, -70)}

      <text x={PAD.l} y={SVG_H-10} fontSize="9" fill="#bbb">도로설계편람 교량편 / KDS 11 50 15</text>
    </svg>
  )
}

function InvertedTDiagram({ g, soil, foundType }: { g: InvertedTGeom; soil: SoilParam; foundType: FoundType }) {
  // ── 편람 역T형 삽도 형상 ──
  // 편람 치수 예: 기초폭=5.900, 앞굽=0.100+0.650=0.750, 뒷굽=0.650+0.100=0.750
  //              기초캡높이=1.820, 헌치높이=1.000, 헌치폭(편측)=1.300
  //              줄기하단폭=1.300(=stemBotW), 줄기상단폭=0.500(=stemTopW)
  //              줄기높이=3.500, 흉벽높이=0.880, 흉벽폭=0.500
  //              말뚝3개, 간격1.300
  //
  // 핵심: 줄기는 상단이 좁고(stemTopW) 하단이 넓음(stemBotW)
  //       헌치는 기초캡 상면에서 경사로 줄기 하단까지 이어짐
  //       흉벽은 줄기 후면 기준

  const SVG_W = 560
  const pileDisplayLen = foundType === 'pile' ? Math.min(soil.pileLen, 10) : 0
  const PAD = { l: 90, r: 72, t: 58, b: foundType === 'pile' ? 28 : 58 }
  const totalH_m = g.footH + g.haunchH + g.stemH + g.backwallH + pileDisplayLen * 0.85 + 0.7
  const totalW_m = g.footWidth + 0.5
  const SVG_H = foundType === 'pile' ? 600 : 540
  const DW = SVG_W - PAD.l - PAD.r
  const DH = SVG_H - PAD.t - PAD.b
  const SX = DW / totalW_m
  const SY = DH / totalH_m

  const ox = PAD.l
  const oy = PAD.t + DH
  const tx = (xm: number) => ox + xm * SX
  const ty = (ym: number) => oy - ym * SY

  // 높이 레벨
  const yCapTop    = g.footH
  const yHaunchTop = yCapTop + g.haunchH
  const yStemTop   = yHaunchTop + g.stemH
  const yBwTop     = yStemTop + g.backwallH

  // ── X 좌표 정의 ──
  const xCapL = 0
  const xCapR = g.footWidth

  // 헌치 하단 좌우 = 기초 캡 상면에서 헌치 시작점
  // 편람: 앞굽=0.750, 뒷굽=0.750
  // 헌치 좌 하단 = footToe (앞굽 우단)
  // 헌치 우 하단 = footWidth - footHeel (뒷굽 좌단)
  const xHaunchBotL = g.footToe
  const xHaunchBotR = g.footWidth - g.footHeel

  // 헌치 상단 좌우 = 줄기 하단
  // 편람: 헌치폭(편측) 1.300 → 헌치 상단 좌 = 헌치 하단 좌 + haunchW
  const xStemBotL = xHaunchBotL + g.haunchW
  const xStemBotR = xHaunchBotR - g.haunchW

  // 줄기 상단: stemTopW 기준, 줄기 중심 기준 정렬
  const stemCX    = (xStemBotL + xStemBotR) / 2
  const xStemTopL = stemCX - g.stemTopW / 2
  const xStemTopR = stemCX + g.stemTopW / 2

  // 흉벽: 줄기 상단 후면(xStemTopR) 기준
  const xBwR = xStemTopR
  const xBwL = xBwR - g.backwallThick

  // 단면 폴리곤
  const ptsBody: [number, number][] = [
    [xCapL,        0],           // ① 기초 캡 하면 좌
    [xCapR,        0],           // ② 기초 캡 하면 우
    [xCapR,        yCapTop],     // ③ 기초 캡 상면 우
    [xHaunchBotR,  yCapTop],     // ④ 헌치 하단 우 (앞굽 상면 끝)
    [xStemBotR,    yHaunchTop],  // ⑤ 헌치 상단 우 = 줄기 하단 우 (경사)
    [xStemTopR,    yStemTop],    // ⑥ 줄기 상단 우
    [xBwR,         yStemTop],    // ⑦ 흉벽 후면 하단
    [xBwR,         yBwTop],      // ⑧ 흉벽 후면 상단
    [xBwL,         yBwTop],      // ⑨ 흉벽 전면 상단
    [xBwL,         yStemTop],    // ⑩ 흉벽 전면 하단
    [xStemTopL,    yStemTop],    // ⑪ 줄기 상단 좌
    [xStemBotL,    yHaunchTop],  // ⑫ 줄기 하단 좌 = 헌치 상단 좌
    [xHaunchBotL,  yCapTop],     // ⑬ 헌치 하단 좌 (경사)
    [xCapL,        yCapTop],     // ⑭ 기초 캡 상면 좌
  ]
  const polyBody = ptsBody.map(([x, y]) => `${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join(' ')

  const DIM = '#1a56b0'
  const FILL = '#dce8f5'
  const STROKE = '#1e3a6e'

  const hDim = (x1: number, x2: number, ym: number, label: string, yOff = -15) => {
    const y = ty(ym) + yOff
    const cx = (tx(x1) + tx(x2)) / 2
    return (
      <g>
        <line x1={tx(x1)} y1={y} x2={tx(x2)} y2={y} stroke={DIM} strokeWidth="1.1"
          markerStart="url(#bR)" markerEnd="url(#bF)"/>
        <line x1={tx(x1)} y1={y-5} x2={tx(x1)} y2={y+5} stroke={DIM} strokeWidth="1"/>
        <line x1={tx(x2)} y1={y-5} x2={tx(x2)} y2={y+5} stroke={DIM} strokeWidth="1"/>
        <text x={cx} y={y-5} textAnchor="middle" fontSize="12" fontWeight="600" fill={DIM}>{label}</text>
      </g>
    )
  }
  const vDim = (xm: number, y1: number, y2: number, label: string, xOff: number) => {
    const x = tx(xm) + xOff
    const cy = (ty(y1) + ty(y2)) / 2
    const anchor = xOff < 0 ? 'end' : 'start'
    const lx = xOff < 0 ? x - 5 : x + 5
    return (
      <g>
        <line x1={x} y1={ty(y1)} x2={x} y2={ty(y2)} stroke={DIM} strokeWidth="1.1"
          markerStart="url(#bR)" markerEnd="url(#bF)"/>
        <line x1={x-5} y1={ty(y1)} x2={x+5} y2={ty(y1)} stroke={DIM} strokeWidth="1"/>
        <line x1={x-5} y1={ty(y2)} x2={x+5} y2={ty(y2)} stroke={DIM} strokeWidth="1"/>
        <text x={lx} y={cy+4} textAnchor={anchor} fontSize="12" fontWeight="600" fill={DIM}>{label}</text>
      </g>
    )
  }

  // 말뚝
  const pileDia_m = soil.pileDia / 1000
  const pileYbot  = -(pileDisplayLen * 0.82)
  const pileXs: number[] = []
  if (foundType === 'pile') {
    const n = soil.pileN
    const center = g.footWidth / 2
    for (let i = 0; i < n; i++) {
      pileXs.push(center + (i - (n - 1) / 2) * soil.pileSpacing)
    }
  }

  return (
    <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fff', display: 'block' }}>
      <defs>
        <marker id="bF" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill={DIM}/>
        </marker>
        <marker id="bR" markerWidth="7" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <path d="M7,0 L0,3.5 L7,7 Z" fill={DIM}/>
        </marker>
        <pattern id="hatchB" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#8b6914" strokeWidth="1.4" strokeOpacity="0.5"/>
        </pattern>
      </defs>

      <text x={SVG_W/2} y={22} textAnchor="middle" fontSize="14" fontWeight="700" fill="#1e2a3a">역T형 교대 단면도</text>
      <text x={SVG_W/2} y={37} textAnchor="middle" fontSize="10" fill="#666">
        {foundType === 'pile' ? '(말뚝기초 / 단위 : m)' : '(직접기초 / 단위 : m)'}
      </text>

      {/* 말뚝 (본체 뒤) */}
      {foundType === 'pile' && pileXs.map((px, i) => (
        <g key={i}>
          <rect x={tx(px - pileDia_m/2)} y={ty(0)}
            width={Math.max(pileDia_m * SX, 6)} height={ty(pileYbot) - ty(0)}
            fill="#b8c8df" stroke="#1a56b0" strokeWidth="1.4"/>
          <line x1={tx(px - pileDia_m/2)-3} y1={ty(pileYbot)}
                x2={tx(px + pileDia_m/2)+3} y2={ty(pileYbot)}
            stroke="#1a56b0" strokeWidth="3"/>
        </g>
      ))}

      {/* 지반 */}
      {foundType === 'spread' && (
        <>
          <rect x={tx(xCapL)-2} y={ty(0)} width={tx(xCapR)-tx(xCapL)+4} height={22}
            fill="url(#hatchB)" opacity={0.5}/>
          <line x1={tx(xCapL)-2} y1={ty(0)} x2={tx(xCapR)+2} y2={ty(0)} stroke="#6b4f1a" strokeWidth="2"/>
        </>
      )}
      {foundType === 'pile' && (
        <line x1={tx(xCapL)-2} y1={ty(0)} x2={tx(xCapR)+2} y2={ty(0)}
          stroke="#6b4f1a" strokeWidth="1.5" strokeDasharray="6,3"/>
      )}

      {/* 뒤채움 */}
      <rect x={tx(xStemTopR)} y={ty(yStemTop)}
        width={tx(xCapR) - tx(xStemTopR)}
        height={ty(yCapTop) - ty(yStemTop)}
        fill="url(#hatchB)" opacity={0.5}/>

      {/* G.L. */}
      <line x1={tx(xStemTopR)-4} y1={ty(yStemTop)} x2={tx(xCapR)+32} y2={ty(yStemTop)}
        stroke="#555" strokeWidth="1.3" strokeDasharray="7,4"/>
      <text x={tx(xCapR)+34} y={ty(yStemTop)+5} fontSize="11" fontWeight="700" fill="#555">G.L.</text>

      {/* 교대 본체 */}
      <polygon points={polyBody} fill={FILL} stroke={STROKE} strokeWidth="2.2" strokeLinejoin="miter"/>
      <line x1={tx(xCapL)} y1={ty(0)} x2={tx(xCapR)} y2={ty(0)} stroke={STROKE} strokeWidth="2.5"/>

      {/* 교좌장치 */}
      <rect x={tx(xBwL)+2} y={ty(yBwTop)-14}
        width={Math.max(g.backwallThick * SX - 4, 8)} height={12}
        fill="#6c8ebf" stroke="#3b5998" strokeWidth="1.2" rx="1"/>

      {/* 폭 치수 */}
      {hDim(xCapL, xCapR, 0, `${g.footWidth.toFixed(3)}`, ty(0)+46)}
      {hDim(xCapL, xHaunchBotL, yCapTop, `${g.footToe.toFixed(3)}`)}
      {hDim(xHaunchBotL, xStemBotL, yHaunchTop, `${g.haunchW.toFixed(3)}`)}
      {hDim(xStemBotL, xStemBotR, yHaunchTop, `${g.stemBotW.toFixed(3)}`)}
      {hDim(xStemBotR, xHaunchBotR, yHaunchTop, `${g.haunchW.toFixed(3)}`)}
      {hDim(xHaunchBotR, xCapR, yCapTop, `${g.footHeel.toFixed(3)}`)}
      {hDim(xStemTopL, xStemTopR, yStemTop, `${g.stemTopW.toFixed(3)}`, -17)}
      {hDim(xBwL, xBwR, yBwTop, `${g.backwallThick.toFixed(3)}`, -17)}

      {/* 우측 높이 치수 */}
      {vDim(xCapR, 0, yCapTop, `${g.footH.toFixed(3)}`, 16)}
      {vDim(xCapR, yCapTop, yHaunchTop, `${g.haunchH.toFixed(3)}`, 16)}
      {vDim(xCapR, yHaunchTop, yStemTop, `${g.stemH.toFixed(3)}`, 16)}
      {vDim(xCapR, yStemTop, yBwTop, `${g.backwallH.toFixed(3)}`, 16)}

      {/* 좌측 전체 높이 */}
      {vDim(xCapL, 0, yBwTop, `${(g.footH+g.haunchH+g.stemH+g.backwallH).toFixed(3)}`, -72)}

      {/* 말뚝 길이 */}
      {foundType === 'pile' && pileXs.length > 0 && (
        <g>
          <line x1={tx(xCapR)+38} y1={ty(0)} x2={tx(xCapR)+38} y2={ty(pileYbot)}
            stroke={DIM} strokeWidth="1.1" markerStart="url(#bR)" markerEnd="url(#bF)"/>
          <text x={tx(xCapR)+43} y={(ty(0)+ty(pileYbot))/2+4}
            fontSize="12" fontWeight="600" fill={DIM}>L={soil.pileLen}m</text>
        </g>
      )}
      {foundType === 'pile' && pileXs.length > 0 && (
        <text x={tx(pileXs[0])} y={ty(pileYbot)+14}
          textAnchor="middle" fontSize="10" fill="#1a56b0">φ{soil.pileDia}</text>
      )}

      <text x={PAD.l} y={SVG_H-10} fontSize="9" fill="#bbb">도로설계편람 교량편 / KDS 11 50 20</text>
    </svg>
  )
}

// ════ 공통 스타일 ════════════════════════════════════════════════
const S = {
  label: { fontSize: '0.72rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: '2px' } as React.CSSProperties,
  inp: { width: '100%', padding: '0.22rem 0.4rem', fontSize: '0.8rem', border: '1px solid var(--border-dark)', borderRadius: '2px', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' } as React.CSSProperties,
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginBottom: '0.3rem' } as React.CSSProperties,
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem', marginBottom: '0.3rem' } as React.CSSProperties,
  sec: { fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-2)', borderBottom: '1px solid var(--border-dark)', paddingBottom: '2px', marginBottom: '0.35rem', marginTop: '0.55rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' } as React.CSSProperties,
}

function F({ label, unit, value, onChange, step, min }: { label: string; unit?: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <div>
      <div style={S.label}>{label}{unit ? ` (${unit})` : ''}</div>
      <input type="number" style={S.inp} value={value} step={step ?? 0.001} min={min ?? 0}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}/>
    </div>
  )
}

// ════ 메인 패널 ══════════════════════════════════════════════════
export default function AbutmentPanel() {
  const { isDesktop } = useResponsive()
  const [tab, setTab] = useState<'input' | 'diagram' | 'result'>('diagram')

  const [abutType, setAbutType] = useState<AbutType>('semi-gravity')
  const [foundType, setFoundType] = useState<FoundType>('spread')
  const [sg, setSg] = useState<SemiGravityGeom>(DEF_SG)
  const [it, setIt] = useState<InvertedTGeom>(DEF_IT)
  const [mat, setMat] = useState<AbutMat>(DEF_MAT)
  const [soil, setSoil] = useState<SoilParam>(DEF_SOIL)
  const [load, setLoad] = useState<AbutLoad>(DEF_LOAD)
  const [reb, setReb] = useState<AbutRebar>(DEF_REB)
  const [result, setResult] = useState<CheckResult | null>(null)

  const upSg = useCallback(<K extends keyof SemiGravityGeom>(k: K, v: SemiGravityGeom[K]) => setSg(p => ({ ...p, [k]: v })), [])
  const upIt = useCallback(<K extends keyof InvertedTGeom>(k: K, v: InvertedTGeom[K]) => setIt(p => ({ ...p, [k]: v })), [])
  const upMat = useCallback(<K extends keyof AbutMat>(k: K, v: AbutMat[K]) => setMat(p => ({ ...p, [k]: v })), [])
  const upSoil = useCallback(<K extends keyof SoilParam>(k: K, v: SoilParam[K]) => setSoil(p => ({ ...p, [k]: v })), [])
  const upLoad = useCallback(<K extends keyof AbutLoad>(k: K, v: AbutLoad[K]) => setLoad(p => ({ ...p, [k]: v })), [])
  const upReb = useCallback(<K extends keyof AbutRebar>(k: K, v: AbutRebar[K]) => setReb(p => ({ ...p, [k]: v })), [])

  // 교대 타입 변경 시 기초 형식 자동 연동
  const handleAbutType = (t: AbutType) => {
    setAbutType(t)
    if (t === 'inverted-t') setFoundType('pile')
    else setFoundType('spread')
    setResult(null)
  }

  const handleCalc = () => {
    const r = abutType === 'semi-gravity'
      ? calcAbutSG(sg, mat, soil, load, reb, foundType)
      : calcAbutIT(it, mat, soil, load, reb, foundType)
    setResult(r)
    if (!isDesktop) setTab('result')
  }

  const tabBtn = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} style={{
      padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: tab === t ? 700 : 500,
      background: tab === t ? 'var(--primary)' : 'var(--surface-2)',
      color: tab === t ? '#fff' : 'var(--text-2)',
      border: '1px solid var(--border-dark)', borderRadius: '2px', cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
    }}>{label}</button>
  )

  // ── 반중력식 입력 폼 ─────────────────────────────────────────
  const SgForm = (
    <>
      <div style={S.sec}>반중력식 교대 제원</div>
      <div style={S.row2}>
        <F label="흉벽 높이" unit="m" value={sg.backwallH} onChange={v => upSg('backwallH', v)} step={0.01}/>
        <F label="흉벽 두께" unit="m" value={sg.backwallThick} onChange={v => upSg('backwallThick', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="줄기 높이" unit="m" value={sg.stemH} onChange={v => upSg('stemH', v)} step={0.1}/>
        <F label="줄기 상단폭" unit="m" value={sg.stemTopW} onChange={v => upSg('stemTopW', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="줄기 하단폭" unit="m" value={sg.stemBotW} onChange={v => upSg('stemBotW', v)} step={0.01}/>
        <F label="전면 계단 높이" unit="m" value={sg.frontStepH} onChange={v => upSg('frontStepH', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="전면 계단 폭" unit="m" value={sg.frontStepW} onChange={v => upSg('frontStepW', v)} step={0.01}/>
        <F label="후면 돌출 높이" unit="m" value={sg.backStepH} onChange={v => upSg('backStepH', v)} step={0.01}/>
      </div>
      <div style={S.row3}>
        <F label="기초 전체폭" unit="m" value={sg.footWidth} onChange={v => upSg('footWidth', v)} step={0.01}/>
        <F label="앞굽 L₁" unit="m" value={sg.footToe} onChange={v => upSg('footToe', v)} step={0.01}/>
        <F label="뒷굽 L₂" unit="m" value={sg.footHeel} onChange={v => upSg('footHeel', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="기초 두께" unit="m" value={sg.footH} onChange={v => upSg('footH', v)} step={0.01}/>
        <F label="단위 폭" unit="m" value={sg.unitWidth} onChange={v => upSg('unitWidth', v)} step={0.1}/>
      </div>
    </>
  )

  // ── 역T형 입력 폼 ────────────────────────────────────────────
  const ItForm = (
    <>
      <div style={S.sec}>역T형 교대 제원</div>
      <div style={S.row2}>
        <F label="흉벽 높이" unit="m" value={it.backwallH} onChange={v => upIt('backwallH', v)} step={0.01}/>
        <F label="흉벽 두께" unit="m" value={it.backwallThick} onChange={v => upIt('backwallThick', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="줄기 높이" unit="m" value={it.stemH} onChange={v => upIt('stemH', v)} step={0.1}/>
        <F label="줄기 상단폭" unit="m" value={it.stemTopW} onChange={v => upIt('stemTopW', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="줄기 하단폭" unit="m" value={it.stemBotW} onChange={v => upIt('stemBotW', v)} step={0.01}/>
        <F label="헌치 높이" unit="m" value={it.haunchH} onChange={v => upIt('haunchH', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="헌치 폭(편측)" unit="m" value={it.haunchW} onChange={v => upIt('haunchW', v)} step={0.01}/>
        <F label="기초 캡 두께" unit="m" value={it.footH} onChange={v => upIt('footH', v)} step={0.01}/>
      </div>
      <div style={S.row3}>
        <F label="기초 전체폭" unit="m" value={it.footWidth} onChange={v => upIt('footWidth', v)} step={0.01}/>
        <F label="앞굽 L₁" unit="m" value={it.footToe} onChange={v => upIt('footToe', v)} step={0.01}/>
        <F label="뒷굽 L₂" unit="m" value={it.footHeel} onChange={v => upIt('footHeel', v)} step={0.01}/>
      </div>
      <div style={S.row2}>
        <F label="단위 폭" unit="m" value={it.unitWidth} onChange={v => upIt('unitWidth', v)} step={0.1}/>
      </div>
    </>
  )

  // ── 기초 형식 (말뚝 입력) ────────────────────────────────────
  const FoundForm = (
    <>
      <div style={S.sec}>기초 형식</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        {(['spread', 'pile'] as FoundType[]).map(ft => (
          <button key={ft} onClick={() => { setFoundType(ft); setResult(null) }} style={{
            flex: 1, padding: '0.28rem', fontSize: '0.76rem', fontWeight: foundType === ft ? 700 : 400,
            background: foundType === ft ? 'var(--primary-bg)' : 'var(--surface-2)',
            color: foundType === ft ? 'var(--primary)' : 'var(--text-3)',
            border: `1px solid ${foundType === ft ? 'var(--primary)' : 'var(--border-dark)'}`,
            borderRadius: '2px', cursor: 'pointer', fontFamily: 'var(--font-mono)',
          }}>
            {ft === 'spread' ? '직접기초' : '말뚝기초'}
          </button>
        ))}
      </div>
      {foundType === 'spread' && (
        <div style={S.row2}>
          <F label="허용지지력 qa" unit="kPa" value={soil.qa} onChange={v => upSoil('qa', v)}/>
          <F label="마찰계수 μ" value={soil.muBase} onChange={v => upSoil('muBase', v)} step={0.05}/>
        </div>
      )}
      {foundType === 'pile' && (
        <>
          <div style={S.row2}>
            <div>
              <div style={S.label}>말뚝 종류</div>
              <select style={S.inp} value={soil.pileType} onChange={e => upSoil('pileType', e.target.value as PileType)}>
                <option value="PHC">PHC 말뚝</option>
                <option value="steel-pipe">강관말뚝</option>
                <option value="cast-in-place">현장타설</option>
                <option value="H-pile">H형강</option>
              </select>
            </div>
            <F label="말뚝 직경" unit="mm" value={soil.pileDia} onChange={v => upSoil('pileDia', v)} step={50}/>
          </div>
          <div style={S.row3}>
            <F label="말뚝 길이" unit="m" value={soil.pileLen} onChange={v => upSoil('pileLen', v)} step={0.5}/>
            <F label="말뚝 수" unit="개" value={soil.pileN} onChange={v => upSoil('pileN', Math.max(1,Math.round(v)))} step={1}/>
            <F label="중심간격" unit="m" value={soil.pileSpacing} onChange={v => upSoil('pileSpacing', v)} step={0.1}/>
          </div>
          <div style={S.row2}>
            <F label="연직 허용 Ra" unit="kN" value={soil.Ra_vert} onChange={v => upSoil('Ra_vert', v)}/>
            <F label="횡방향 허용 Ra" unit="kN" value={soil.Ra_horiz} onChange={v => upSoil('Ra_horiz', v)}/>
          </div>
          <div style={S.row2}>
            <F label="마찰계수 μ" value={soil.muBase} onChange={v => upSoil('muBase', v)} step={0.05}/>
          </div>
        </>
      )}
    </>
  )

  // ── 전체 입력 패널 ─────────────────────────────────────────
  const InputPanel = (
    <div style={{ padding: '0.55rem 0.75rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* 교대 형식 */}
      <div style={S.sec}>교대 형식 선택</div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
        {(['semi-gravity', 'inverted-t'] as AbutType[]).map(at => (
          <button key={at} onClick={() => handleAbutType(at)} style={{
            flex: 1, padding: '0.3rem', fontSize: '0.76rem', fontWeight: abutType === at ? 700 : 400,
            background: abutType === at ? 'var(--primary-bg)' : 'var(--surface-2)',
            color: abutType === at ? 'var(--primary)' : 'var(--text-3)',
            border: `1px solid ${abutType === at ? 'var(--primary)' : 'var(--border-dark)'}`,
            borderRadius: '2px', cursor: 'pointer', fontFamily: 'var(--font-mono)',
          }}>
            {at === 'semi-gravity' ? '반중력식' : '역T형'}
          </button>
        ))}
      </div>

      {/* 재료 */}
      <div style={S.sec}>재료</div>
      <div style={S.row3}>
        <F label="fck" unit="MPa" value={mat.fck} onChange={v => upMat('fck', v)} step={1}/>
        <F label="fy" unit="MPa" value={mat.fy} onChange={v => upMat('fy', v)} step={1}/>
        <F label="γc" unit="kN/m³" value={mat.gammaCon} onChange={v => upMat('gammaCon', v)} step={0.5}/>
      </div>

      {/* 교대 형식별 제원 */}
      {abutType === 'semi-gravity' ? SgForm : ItForm}

      {/* 토질 */}
      <div style={S.sec}>토질 조건</div>
      <div style={S.row3}>
        <F label="γs" unit="kN/m³" value={soil.gamma} onChange={v => upSoil('gamma', v)} step={0.5}/>
        <F label="φ" unit="°" value={soil.phi} onChange={v => upSoil('phi', v)} step={1}/>
        <F label="c" unit="kPa" value={soil.c} onChange={v => upSoil('c', v)}/>
      </div>
      <div style={S.row2}>
        <div>
          <div style={S.label}>Ka 방식</div>
          <select style={S.inp} value={soil.kaMode} onChange={e => upSoil('kaMode', e.target.value as 'auto'|'manual')}>
            <option value="auto">자동 (Rankine)</option>
            <option value="manual">직접입력</option>
          </select>
        </div>
        {soil.kaMode === 'manual'
          ? <F label="Ka" value={soil.Ka} onChange={v => upSoil('Ka', v)} step={0.001}/>
          : <div><div style={S.label}>Ka (자동)</div>
              <div style={{ ...S.inp, background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                {calcKa(soil.phi).toFixed(4)}
              </div>
            </div>}
      </div>

      {/* 기초 형식 */}
      {FoundForm}

      {/* 상부 하중 */}
      <div style={S.sec}>상부 하중</div>
      <div style={S.row2}>
        <F label="고정하중 P_D" unit="kN/m" value={load.PDead} onChange={v => upLoad('PDead', v)}/>
        <F label="활하중 P_L" unit="kN/m" value={load.PLive} onChange={v => upLoad('PLive', v)}/>
      </div>
      <div style={S.row3}>
        <F label="브레이킹" unit="kN/m" value={load.braking} onChange={v => upLoad('braking', v)}/>
        <F label="풍하중" unit="kN/m" value={load.windH} onChange={v => upLoad('windH', v)}/>
        <F label="온도·건조" unit="kN/m" value={load.tempH} onChange={v => upLoad('tempH', v)}/>
      </div>
      <div style={S.row2}>
        <F label="상재하중 q" unit="kPa" value={load.surcharge} onChange={v => upLoad('surcharge', v)}/>
        <F label="설계수위 hw" unit="m" value={load.waterDepth} onChange={v => upLoad('waterDepth', v)} step={0.1}/>
      </div>

      {/* 철근 */}
      <div style={S.sec}>철근 상세</div>
      <div style={S.row3}>
        <div>
          <div style={S.label}>전면벽 주근 D</div>
          <select style={S.inp} value={reb.stemMainDia} onChange={e => upReb('stemMainDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <F label="주근 간격" unit="mm" value={reb.stemMainSpacing} onChange={v => upReb('stemMainSpacing', v)} step={25}/>
        <F label="피복" unit="mm" value={reb.stemCover} onChange={v => upReb('stemCover', v)} step={5}/>
      </div>
      <div style={S.row3}>
        <div>
          <div style={S.label}>기초판 주근 D</div>
          <select style={S.inp} value={reb.footMainDia} onChange={e => upReb('footMainDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <F label="간격" unit="mm" value={reb.footMainSpacing} onChange={v => upReb('footMainSpacing', v)} step={25}/>
        <F label="피복" unit="mm" value={reb.footCover} onChange={v => upReb('footCover', v)} step={5}/>
      </div>

      <button onClick={handleCalc} style={{
        marginTop: '0.75rem', width: '100%', padding: '0.5rem',
        background: 'var(--primary)', color: '#fff', border: 'none',
        borderRadius: '2px', fontSize: '0.82rem', fontWeight: 700,
        cursor: 'pointer', fontFamily: 'var(--font-mono)',
      }}>▶ 검토 실행</button>
    </div>
  )

  const DiagramPanel = (
    <div style={{ padding: '0.5rem', background: '#fff', overflowY: 'auto', height: '100%' }}>
      {abutType === 'semi-gravity'
        ? <SemiGravityDiagram g={sg}/>
        : <InvertedTDiagram g={it} soil={soil} foundType={foundType}/>}
    </div>
  )

  const ResultPanel = result
    ? <ResultTable items={result.items} overallStatus={result.overallStatus}/>
    : <div style={{ padding: '2rem', color: 'var(--text-3)', fontSize: '0.8rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
        검토 실행 후 결과가 표시됩니다
      </div>

  if (isDesktop) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
        {/* 입력 패널 */}
        <div style={{ width: '22rem', minWidth: '22rem', borderRight: '1px solid var(--border-dark)', overflowY: 'auto' }}>
          {InputPanel}
        </div>
        {/* 단면도 패널 — RC보 수준 고정폭 */}
        <div style={{
          width: 'clamp(360px, 44%, 580px)',
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-dark)',
          background: '#fff',
        }}>
          <div style={{ fontSize: '0.67rem', fontWeight: 700, color: 'var(--text-3)', padding: '0.3rem 0.6rem', borderBottom: '1px solid var(--border-light)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {abutType === 'semi-gravity' ? 'SEMI-GRAVITY ABUTMENT' : 'INVERTED-T ABUTMENT'} / {foundType === 'spread' ? 'SPREAD FOUNDATION' : 'PILE FOUNDATION'}
          </div>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>{DiagramPanel}</div>
        </div>
        {/* 결과 패널 */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: 'none', overflowY: 'auto' }}>
          {ResultPanel}
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
        {tab === 'result'  && ResultPanel}
      </div>
    </div>
  )
}
