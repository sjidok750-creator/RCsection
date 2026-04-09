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

// ── 교대 타입 ────────────────────────────────────────────────────
type AbutmentType = 'gravity' | 'inverted-t' | 'cantilever' | 'counterfort'
type SoilType = 'sand' | 'sand-gravel' | 'clay' | 'rock'

interface AbutmentGeom {
  type: AbutmentType
  // 전면벽 (Stem)
  stemHeight: number      // 전면벽 높이 (m)
  stemThickTop: number    // 전면벽 상단 두께 (mm)
  stemThickBot: number    // 전면벽 하단 두께 (mm)
  // 흉벽 (Breast wall / Back wall)
  backwallHeight: number  // 흉벽 높이 (m)
  backwallThick: number   // 흉벽 두께 (mm)
  // 기초판 (Footing)
  footWidth: number       // 기초판 폭 (m)
  footThick: number       // 기초판 두께 (mm)
  footToe: number         // 앞굽 길이 (m)
  footHeel: number        // 뒷굽 길이 (m)
  // 날개벽 (Wing wall)
  wingLength: number      // 날개벽 길이 (m)
  wingThick: number       // 날개벽 두께 (mm)
  // 공통
  unitWidth: number       // 검토 단위 폭 (m), 통상 1.0
}

interface AbutmentMaterial {
  fck: number             // 콘크리트 (MPa)
  fy: number              // 철근 (MPa)
  Es: number              // 철근 탄성계수 (MPa)
  gammaConcrete: number   // 콘크리트 단위중량 (kN/m³)
}

interface SoilParam {
  soilType: SoilType
  gamma: number           // 흙 단위중량 (kN/m³)
  phi: number             // 내부마찰각 (°)
  c: number               // 점착력 (kPa)
  Ka: number              // 주동토압계수 (자동계산 또는 직접입력)
  kaMode: 'auto' | 'manual'
  delta: number           // 벽마찰각 (°)
  // 지반 지지력
  qa: number              // 허용지지력 (kPa)
  muBase: number          // 기초 마찰계수
}

interface AbutmentLoad {
  // 상부 반력 (교좌로부터)
  PDead: number           // 고정하중 반력 (kN/m)
  PLive: number           // 활하중 반력 (kN/m)
  // 수평 하중
  braking: number         // 브레이킹 하중 (kN/m) — KDS 24 12 21
  windH: number           // 풍하중 수평 (kN/m)
  // 온도·건조수축 (kN/m)
  tempH: number
  // 뒤채움 활하중 등분포 (등가토압)
  surcharge: number       // 상재하중 (kPa), 통상 10~12 kPa
  // 수압
  waterDepth: number      // 설계수위 깊이 (m)
  gammaWater: number      // 물 단위중량 (kN/m³)
}

interface StemRebar {
  // 전면벽 주근 (수직)
  mainDia: number
  mainSpacing: number     // 간격 (mm)
  mainRows: number        // 단수
  // 배력근 (수평)
  shrinkDia: number
  shrinkSpacing: number
  // 피복
  cover: number
}

interface FootRebar {
  // 앞굽 하단
  toeDia: number
  toeSpacing: number
  // 뒷굽 상단
  heelDia: number
  heelSpacing: number
  cover: number
}

interface BackwallRebar {
  mainDia: number
  mainSpacing: number
  cover: number
}

// ── 기본값 ───────────────────────────────────────────────────────
const DEF_GEOM: AbutmentGeom = {
  type: 'inverted-t',
  stemHeight: 6.5, stemThickTop: 500, stemThickBot: 700,
  backwallHeight: 1.2, backwallThick: 400,
  footWidth: 5.5, footThick: 800, footToe: 1.5, footHeel: 2.8,
  wingLength: 4.0, wingThick: 350,
  unitWidth: 1.0,
}
const DEF_MAT: AbutmentMaterial = { fck: 27, fy: 400, Es: 200000, gammaConcrete: 24 }
const DEF_SOIL: SoilParam = {
  soilType: 'sand', gamma: 18, phi: 30, c: 0,
  Ka: 0.333, kaMode: 'auto', delta: 20,
  qa: 300, muBase: 0.5,
}
const DEF_LOAD: AbutmentLoad = {
  PDead: 450, PLive: 250,
  braking: 25, windH: 10, tempH: 15,
  surcharge: 10, waterDepth: 0, gammaWater: 10,
}
const DEF_STEM_REB: StemRebar = { mainDia: 22, mainSpacing: 150, mainRows: 1, shrinkDia: 16, shrinkSpacing: 200, cover: 80 }
const DEF_FOOT_REB: FootRebar = { toeDia: 22, toeSpacing: 150, heelDia: 22, heelSpacing: 150, cover: 80 }
const DEF_BW_REB: BackwallRebar = { mainDia: 16, mainSpacing: 200, cover: 70 }

// ── 계산 헬퍼 ────────────────────────────────────────────────────
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

// 주동토압계수 Rankine
function calcKa(phi_deg: number): number {
  const phi = (phi_deg * Math.PI) / 180
  return Math.tan(Math.PI / 4 - phi / 2) ** 2
}

// 전면벽 단면적 (간격당)
function stemAs(reb: StemRebar): number {
  const Abar = REBAR_AREA[reb.mainDia] ?? 0
  return (Abar / reb.mainSpacing) * 1000 * reb.mainRows // mm²/m
}
function footAs(dia: number, spacing: number): number {
  return ((REBAR_AREA[dia] ?? 0) / spacing) * 1000
}

// ── 주요 검토 계산 ───────────────────────────────────────────────
function calcAbutment(
  geom: AbutmentGeom,
  mat: AbutmentMaterial,
  soil: SoilParam,
  load: AbutmentLoad,
  stemReb: StemRebar,
  footReb: FootRebar,
  bwReb: BackwallRebar,
): CheckResult {
  const items: CheckItem[] = []
  const warns: string[] = []

  const { fck, fy, gammaConcrete } = mat
  const Ka = soil.kaMode === 'auto' ? calcKa(soil.phi) : soil.Ka
  const b = geom.unitWidth * 1000 // mm (단위폭)

  // 유효깊이 헬퍼
  const dStem = geom.stemThickBot - stemReb.cover - (stemReb.mainDia / 2)
  const dToe  = geom.footThick - footReb.cover - (footReb.toeDia / 2)
  const dHeel = geom.footThick - footReb.cover - (footReb.heelDia / 2)
  const dBw   = geom.backwallThick - bwReb.cover - (bwReb.mainDia / 2)

  const phi_flex = 0.85
  const phi_shear = 0.75
  const lambda = 1.0
  const fckSqrt = Math.sqrt(fck)

  // ── 1. 토압 합력 계산 ─────────────────────────────────────────
  const H_total = geom.stemHeight + geom.backwallHeight + geom.footThick / 1000
  const Ea_tri  = 0.5 * soil.gamma * Ka * H_total ** 2      // kN/m (삼각형 토압)
  const Ea_sur  = load.surcharge * Ka * H_total              // kN/m (상재 등분포)
  const Ea_water = load.waterDepth > 0
    ? 0.5 * load.gammaWater * load.waterDepth ** 2 : 0
  const Ea_total = Ea_tri + Ea_sur + Ea_water               // 전체 수평 합력

  // 작용점 높이 (기초 하면 기준)
  const yTri = H_total / 3
  const ySur = H_total / 2
  const yWater = load.waterDepth / 3
  const Msoil = Ea_tri * yTri + Ea_sur * ySur + Ea_water * yWater  // kN·m/m (전도 모멘트)

  // ── 2. 안정검토 — 전도 (KDS 11 50 15, F.S. ≥ 2.0) ────────────
  const stemThickAvg = (geom.stemThickTop + geom.stemThickBot) / 2 / 1000 // m
  const footToe = geom.footToe
  const footHeel = geom.footHeel
  const stemH = geom.stemHeight

  // 수직력 및 저항 모멘트 (기초 앞굽 끝 기준)
  const W_stem   = gammaConcrete * stemThickAvg * stemH * geom.unitWidth
  const W_foot   = gammaConcrete * geom.footWidth * geom.footThick / 1000 * geom.unitWidth
  const W_soil_heel = soil.gamma * footHeel * (stemH + geom.backwallHeight) * geom.unitWidth
  const W_super  = (load.PDead + load.PLive) * geom.unitWidth
  const W_bw     = gammaConcrete * geom.backwallThick / 1000 * geom.backwallHeight * geom.unitWidth
  const V_total  = W_stem + W_foot + W_soil_heel + W_super + W_bw

  // 저항 모멘트 (앞굽 선단 기준)
  const xStem  = footToe + stemThickAvg / 2
  const xFoot  = geom.footWidth / 2
  const xHeel  = geom.footWidth - footHeel / 2
  const xSuper = footToe + stemThickAvg / 2  // 교좌 위치 ≈ 줄기 중심
  const xBw    = footToe + stemThickAvg / 2

  const Mr = W_stem * xStem + W_foot * xFoot + W_soil_heel * xHeel
    + W_super * xSuper + W_bw * xBw
  // 수평 하중 모멘트 (전도)
  const H_external = load.braking + load.windH + load.tempH
  const Mo = Msoil + H_external * (stemH / 2) // 외부 수평력 작용점 ≈ 중간

  const FS_overturning = Mr / Mo
  const ok_ot = FS_overturning >= 2.0

  {
    const steps: CalcLine[] = [
      sec('■ 토압 산정 (Rankine 주동토압)'),
      ln(`Ka = tan²(45° - φ/2) = tan²(45° - ${soil.phi}°/2)`, `${Ka.toFixed(4)}`),
      ln(`뒤채움 높이 H = H_벽 + H_흉벽 + t_기초 = ${geom.stemHeight} + ${geom.backwallHeight} + ${geom.footThick/1000}`, `${H_total.toFixed(2)} m`),
      ln(`삼각형 토압 Ea = ½·γ·Ka·H² = ½×${soil.gamma}×${Ka.toFixed(3)}×${H_total.toFixed(2)}²`, `${Ea_tri.toFixed(2)} kN/m`),
      ln(`상재 등분포 Ea_q = q·Ka·H = ${load.surcharge}×${Ka.toFixed(3)}×${H_total.toFixed(2)}`, `${Ea_sur.toFixed(2)} kN/m`),
      load.waterDepth > 0 ? ln(`수압 Ew = ½·γw·hw² = ½×${load.gammaWater}×${load.waterDepth}²`, `${Ea_water.toFixed(2)} kN/m`) : note('수압 없음 (설계수위 = 0)'),
      ln(`수평 합력 ΣH = ${Ea_tri.toFixed(2)} + ${Ea_sur.toFixed(2)} + ${Ea_water.toFixed(2)}`, `${Ea_total.toFixed(2)} kN/m`, 0, 'eq-key'),
      sec('■ 전도 안정 (기준: F.S. ≥ 2.0, KDS 11 50 15)'),
      ln(`저항 모멘트 Mr = Σ(W×x)`, `${Mr.toFixed(1)} kN·m/m`),
      ln(`  W_줄기 = ${W_stem.toFixed(1)} kN/m × ${xStem.toFixed(2)} m`, `${(W_stem*xStem).toFixed(1)} kN·m/m`, 1),
      ln(`  W_기초 = ${W_foot.toFixed(1)} kN/m × ${xFoot.toFixed(2)} m`, `${(W_foot*xFoot).toFixed(1)} kN·m/m`, 1),
      ln(`  W_뒤채움 = ${W_soil_heel.toFixed(1)} kN/m × ${xHeel.toFixed(2)} m`, `${(W_soil_heel*xHeel).toFixed(1)} kN·m/m`, 1),
      ln(`  W_상부 = ${W_super.toFixed(1)} kN/m × ${xSuper.toFixed(2)} m`, `${(W_super*xSuper).toFixed(1)} kN·m/m`, 1),
      ln(`전도 모멘트 Mo = Ea_삼각형×H/3 + Ea_q×H/2 + 외부수평×H/2`, `${Mo.toFixed(1)} kN·m/m`),
      ln(`F.S._전도 = Mr / Mo = ${Mr.toFixed(1)} / ${Mo.toFixed(1)}`, `${FS_overturning.toFixed(3)}`, 0, 'result'),
      verdict(ok_ot, Mo, Mr / 2.0, 'kN·m/m'),
    ]
    if (!ok_ot) warns.push('전도 안정 F.S. < 2.0')
    items.push({
      id: 'overturning', label: '전도 안정', demandSymbol: 'Mo', capacitySymbol: 'Mr/2',
      demand: Mo, capacity: Mr / 2.0, unit: 'kN·m/m',
      SF: FS_overturning, ratio: 1 / FS_overturning * 2.0,
      status: ok_ot ? 'OK' : 'NG',
      formula: 'F.S. = Mr / Mo ≥ 2.0 (KDS 11 50 15)',
      detail: {}, steps,
    })
  }

  // ── 3. 안정검토 — 활동 (F.S. ≥ 1.5) ─────────────────────────
  const Hres = V_total * soil.muBase
  const H_act = Ea_total + H_external
  const FS_sliding = Hres / H_act
  const ok_sl = FS_sliding >= 1.5
  {
    const steps: CalcLine[] = [
      sec('■ 활동 안정 (기준: F.S. ≥ 1.5, KDS 11 50 15)'),
      ln(`수직 합력 ΣV = ${V_total.toFixed(1)} kN/m`),
      ln(`저항력 Hr = μ·ΣV = ${soil.muBase}×${V_total.toFixed(1)}`, `${Hres.toFixed(2)} kN/m`),
      ln(`수평 작용력 ΣH = 토압 + 외부수평 = ${Ea_total.toFixed(2)} + ${H_external.toFixed(2)}`, `${H_act.toFixed(2)} kN/m`),
      ln(`F.S._활동 = Hr / ΣH = ${Hres.toFixed(2)} / ${H_act.toFixed(2)}`, `${FS_sliding.toFixed(3)}`, 0, 'result'),
      verdict(ok_sl, H_act, Hres / 1.5, 'kN/m'),
      note('점착력 c > 0인 경우 Hr = μ·ΣV + c·B (이 계산에서는 사질토 가정)'),
    ]
    if (!ok_sl) warns.push('활동 안정 F.S. < 1.5')
    items.push({
      id: 'sliding', label: '활동 안정', demandSymbol: 'ΣH', capacitySymbol: 'Hr/1.5',
      demand: H_act, capacity: Hres / 1.5, unit: 'kN/m',
      SF: FS_sliding, ratio: H_act / (Hres / 1.5),
      status: ok_sl ? 'OK' : 'NG',
      formula: 'F.S. = μ·ΣV / ΣH ≥ 1.5',
      detail: {}, steps,
    })
  }

  // ── 4. 지반 지지력 검토 ───────────────────────────────────────
  const e = geom.footWidth / 2 - (Mr - Mo) / V_total  // 편심거리
  const Beff = geom.footWidth - 2 * e                  // 유효폭
  const q_max = V_total / Beff
  const ok_bc = q_max <= soil.qa
  {
    const steps: CalcLine[] = [
      sec('■ 지반 지지력 검토 (KDS 11 50 15)'),
      ln(`합력 작용점 x̄ = (Mr - Mo) / ΣV = (${Mr.toFixed(1)} - ${Mo.toFixed(1)}) / ${V_total.toFixed(1)}`, `${((Mr-Mo)/V_total).toFixed(3)} m`),
      ln(`편심 e = B/2 - x̄ = ${geom.footWidth}/2 - ${((Mr-Mo)/V_total).toFixed(3)}`, `${e.toFixed(3)} m`),
      Math.abs(e) > geom.footWidth / 6
        ? { type: 'verdict' as const, text: '⚠ e > B/6 : 기초판 일부 인장 — 유효폭 산정', value: '' }
        : note(`e = ${e.toFixed(3)} m ≤ B/6 = ${(geom.footWidth/6).toFixed(3)} m ✓`),
      ln(`유효 기초폭 B' = B - 2e = ${geom.footWidth} - 2×${e.toFixed(3)}`, `${Beff.toFixed(3)} m`),
      ln(`최대 지반 반력 q_max = ΣV / B' = ${V_total.toFixed(1)} / ${Beff.toFixed(3)}`, `${q_max.toFixed(1)} kPa`, 0, 'result'),
      ln(`허용 지지력 qa`, `${soil.qa} kPa`),
      verdict(ok_bc, q_max, soil.qa, 'kPa'),
    ]
    if (!ok_bc) warns.push('지반 지지력 초과')
    if (Math.abs(e) > geom.footWidth / 6) warns.push('편심 e > B/6 — 기초 재설계 필요')
    items.push({
      id: 'bearing', label: '지반 지지력', demandSymbol: 'q_max', capacitySymbol: 'qa',
      demand: q_max, capacity: soil.qa, unit: 'kPa',
      SF: soil.qa / q_max, ratio: q_max / soil.qa,
      status: ok_bc ? 'OK' : 'NG',
      formula: 'q_max = ΣV/B\' ≤ qa',
      detail: {}, steps,
    })
  }

  // ── 5. 전면벽 (줄기) 휨 강도 ─────────────────────────────────
  // 검토 위치: 기초 상면 (줄기 하단) — 최대 모멘트
  const Mu_stem_kNm = Ea_tri * (geom.stemHeight / 3)
    + Ea_sur * (geom.stemHeight / 2)
    + (H_external * geom.stemHeight / 2)  // kN·m/m

  const As_stem = stemAs(stemReb)
  const a_stem  = (As_stem * fy) / (0.85 * fck * b)
  const phiMn_stem = phi_flex * As_stem * fy * (dStem - a_stem / 2) / 1e6  // kN·m/m
  const ok_stem_flex = phiMn_stem >= Mu_stem_kNm
  {
    const As_one = REBAR_AREA[stemReb.mainDia] ?? 0
    const steps: CalcLine[] = [
      sec('■ 전면벽(줄기) 휨 강도 검토 (KDS 14 20 20)'),
      note(`검토 위치: 기초 상면 (줄기 하단부 최대 모멘트)`),
      ln(`설계 휨모멘트 Mu = Ea_tri·H_stem/3 + Ea_q·H_stem/2 + 외부수평·H_stem/2`),
      ln(`  = ${Ea_tri.toFixed(2)}×${(geom.stemHeight/3).toFixed(2)} + ${Ea_sur.toFixed(2)}×${(geom.stemHeight/2).toFixed(2)} + ${H_external.toFixed(2)}×${(geom.stemHeight/2).toFixed(2)}`,
        `${Mu_stem_kNm.toFixed(1)} kN·m/m`, 1),
      ln(`인장 철근 D${stemReb.mainDia}@${stemReb.mainSpacing} (${stemReb.mainRows}단)`),
      ln(`  As = ${As_one.toFixed(1)}mm² × 1000/${stemReb.mainSpacing} × ${stemReb.mainRows}`, `${As_stem.toFixed(0)} mm²/m`, 1),
      ln(`  유효깊이 d = ${geom.stemThickBot} - ${stemReb.cover} - ${stemReb.mainDia/2}`, `${dStem.toFixed(0)} mm`, 1),
      ln(`등가 응력블록 a = As·fy / (0.85·fck·b) = ${As_stem.toFixed(0)}×${fy}/(0.85×${fck}×1000)`, `${a_stem.toFixed(1)} mm`),
      ln(`φMn = φ·As·fy·(d - a/2) = ${phi_flex}×${As_stem.toFixed(0)}×${fy}×(${dStem.toFixed(0)}-${(a_stem/2).toFixed(1)})/10⁶`,
        `${phiMn_stem.toFixed(1)} kN·m/m`, 0, 'result'),
      verdict(ok_stem_flex, Mu_stem_kNm, phiMn_stem, 'kN·m/m'),
    ]
    if (!ok_stem_flex) warns.push('전면벽 휨 강도 부족')
    items.push({
      id: 'stem-flex', label: '전면벽 휨강도', demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Mu_stem_kNm, capacity: phiMn_stem, unit: 'kN·m/m',
      SF: phiMn_stem / Mu_stem_kNm, ratio: Mu_stem_kNm / phiMn_stem,
      status: ok_stem_flex ? 'OK' : 'NG',
      formula: 'Mu ≤ φMn = φ·As·fy·(d - a/2)',
      detail: {}, steps,
    })
  }

  // ── 6. 전면벽 전단 강도 ───────────────────────────────────────
  const Vu_stem = Ea_total + H_external  // kN/m
  const Vc_stem = (lambda / 6) * fckSqrt * b * dStem / 1000  // kN/m
  const phiVc_stem = phi_shear * Vc_stem
  const ok_stem_shear = phiVc_stem >= Vu_stem
  {
    const steps: CalcLine[] = [
      sec('■ 전면벽 전단 강도 검토 (KDS 14 20 22)'),
      ln(`설계 전단력 Vu = ΣH = ${Ea_tri.toFixed(2)} + ${Ea_sur.toFixed(2)} + ${Ea_water.toFixed(2)} + ${H_external.toFixed(2)}`,
        `${Vu_stem.toFixed(2)} kN/m`),
      ln(`콘크리트 전단강도 Vc = (λ/6)√fck·b·d = (${lambda}/6)×√${fck}×1000×${dStem.toFixed(0)}/1000`,
        `${Vc_stem.toFixed(1)} kN/m`),
      ln(`φVc = ${phi_shear}×${Vc_stem.toFixed(1)}`, `${phiVc_stem.toFixed(1)} kN/m`, 0, 'result'),
      verdict(ok_stem_shear, Vu_stem, phiVc_stem, 'kN/m'),
      note('전면벽 전단 — 스터럽 없는 슬래브 형식으로 검토'),
    ]
    if (!ok_stem_shear) warns.push('전면벽 전단 강도 부족')
    items.push({
      id: 'stem-shear', label: '전면벽 전단강도', demandSymbol: 'Vu', capacitySymbol: 'φVc',
      demand: Vu_stem, capacity: phiVc_stem, unit: 'kN/m',
      SF: phiVc_stem / Vu_stem, ratio: Vu_stem / phiVc_stem,
      status: ok_stem_shear ? 'OK' : 'NG',
      formula: 'Vu ≤ φVc = φ·(λ/6)·√fck·b·d',
      detail: {}, steps,
    })
  }

  // ── 7. 뒷굽 기초판 휨 강도 ───────────────────────────────────
  // 뒷굽: 줄기 후면에서 기초 끝까지, 순 상향 토압 - 자중
  const q_avg = V_total / geom.footWidth   // 평균 지반 반력 kN/m²
  const w_foot_self = gammaConcrete * geom.footThick / 1000       // 기초 자중 kN/m²
  const q_net_heel  = q_avg - w_foot_self  // 순 반력 (보수적: 뒤채움 자중 무시)
  const Mu_heel_kNm = (q_net_heel * footHeel ** 2) / 2          // kN·m/m
  const As_heel = footAs(footReb.heelDia, footReb.heelSpacing)
  const a_heel  = (As_heel * fy) / (0.85 * fck * b)
  const phiMn_heel = phi_flex * As_heel * fy * (dHeel - a_heel / 2) / 1e6
  const ok_heel = phiMn_heel >= Mu_heel_kNm
  {
    const steps: CalcLine[] = [
      sec('■ 뒷굽 기초판 휨 강도 검토 (KDS 14 20 20)'),
      ln(`평균 지반 반력 q_avg = ΣV / B = ${V_total.toFixed(1)} / ${geom.footWidth}`, `${q_avg.toFixed(1)} kN/m²`),
      ln(`기초 자중 w_foot = γc·t_foot = ${gammaConcrete}×${geom.footThick/1000}`, `${w_foot_self.toFixed(1)} kN/m²`),
      ln(`순 지반 반력 q_net = q_avg - w_foot = ${q_avg.toFixed(1)} - ${w_foot_self.toFixed(1)}`, `${q_net_heel.toFixed(1)} kN/m²`),
      ln(`설계 휨모멘트 Mu = q_net·L²/2 = ${q_net_heel.toFixed(1)}×${footHeel}²/2`, `${Mu_heel_kNm.toFixed(1)} kN·m/m`),
      ln(`뒷굽 상단 D${footReb.heelDia}@${footReb.heelSpacing}, As = ${As_heel.toFixed(0)} mm²/m`),
      ln(`유효깊이 d = ${geom.footThick} - ${footReb.cover} - ${footReb.heelDia/2}`, `${dHeel.toFixed(0)} mm`),
      ln(`a = ${As_heel.toFixed(0)}×${fy}/(0.85×${fck}×1000)`, `${a_heel.toFixed(1)} mm`),
      ln(`φMn = ${phi_flex}×${As_heel.toFixed(0)}×${fy}×(${dHeel.toFixed(0)}-${(a_heel/2).toFixed(1)})/10⁶`,
        `${phiMn_heel.toFixed(1)} kN·m/m`, 0, 'result'),
      verdict(ok_heel, Mu_heel_kNm, phiMn_heel, 'kN·m/m'),
    ]
    if (!ok_heel) warns.push('뒷굽 기초판 휨 강도 부족')
    items.push({
      id: 'heel-flex', label: '뒷굽 기초판 휨', demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Mu_heel_kNm, capacity: phiMn_heel, unit: 'kN·m/m',
      SF: phiMn_heel / Mu_heel_kNm, ratio: Mu_heel_kNm / phiMn_heel,
      status: ok_heel ? 'OK' : 'NG',
      formula: 'Mu = q_net·L²/2 ≤ φMn',
      detail: {}, steps,
    })
  }

  // ── 8. 앞굽 기초판 휨 강도 ───────────────────────────────────
  const q_toe = V_total / Beff * (1 + 6 * e / Beff)  // 앞굽 최대 반력 (사다리꼴)
  const q_toe_avg = (q_toe + q_avg) / 2
  const Mu_toe_kNm = (q_toe_avg * footToe ** 2) / 2 - (w_foot_self * footToe ** 2) / 2
  const As_toe = footAs(footReb.toeDia, footReb.toeSpacing)
  const a_toe  = (As_toe * fy) / (0.85 * fck * b)
  const phiMn_toe = phi_flex * As_toe * fy * (dToe - a_toe / 2) / 1e6
  const ok_toe = phiMn_toe >= Math.abs(Mu_toe_kNm)
  {
    const steps: CalcLine[] = [
      sec('■ 앞굽 기초판 휨 강도 검토 (KDS 14 20 20)'),
      ln(`앞굽 최대 지반 반력 q_toe = ΣV/B'·(1+6e/B')`, `${q_toe.toFixed(1)} kN/m²`),
      ln(`설계 휨모멘트 Mu = (q_toe_avg - w_foot)·L_toe²/2`, `${Math.abs(Mu_toe_kNm).toFixed(1)} kN·m/m`),
      ln(`앞굽 하단 D${footReb.toeDia}@${footReb.toeSpacing}, As = ${As_toe.toFixed(0)} mm²/m`),
      ln(`유효깊이 d = ${geom.footThick} - ${footReb.cover} - ${footReb.toeDia/2}`, `${dToe.toFixed(0)} mm`),
      ln(`φMn = ${phi_flex}×${As_toe.toFixed(0)}×${fy}×(${dToe.toFixed(0)}-${(a_toe/2).toFixed(1)})/10⁶`,
        `${phiMn_toe.toFixed(1)} kN·m/m`, 0, 'result'),
      verdict(ok_toe, Math.abs(Mu_toe_kNm), phiMn_toe, 'kN·m/m'),
    ]
    if (!ok_toe) warns.push('앞굽 기초판 휨 강도 부족')
    items.push({
      id: 'toe-flex', label: '앞굽 기초판 휨', demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Math.abs(Mu_toe_kNm), capacity: phiMn_toe, unit: 'kN·m/m',
      SF: phiMn_toe / Math.abs(Mu_toe_kNm), ratio: Math.abs(Mu_toe_kNm) / phiMn_toe,
      status: ok_toe ? 'OK' : 'NG',
      formula: 'Mu = q_avg·L_toe²/2 ≤ φMn',
      detail: {}, steps,
    })
  }

  // ── 9. 흉벽 휨 강도 ──────────────────────────────────────────
  const Ea_bw_tri = 0.5 * soil.gamma * Ka * geom.backwallHeight ** 2
  const Ea_bw_sur = load.surcharge * Ka * geom.backwallHeight
  const Mu_bw_kNm = Ea_bw_tri * geom.backwallHeight / 3 + Ea_bw_sur * geom.backwallHeight / 2
  const As_bw = footAs(bwReb.mainDia, bwReb.mainSpacing)
  const a_bw  = (As_bw * fy) / (0.85 * fck * b)
  const phiMn_bw = phi_flex * As_bw * fy * (dBw - a_bw / 2) / 1e6
  const ok_bw = phiMn_bw >= Mu_bw_kNm
  {
    const steps: CalcLine[] = [
      sec('■ 흉벽(뒷벽) 휨 강도 검토 (KDS 14 20 20)'),
      ln(`흉벽 높이 H_bw = ${geom.backwallHeight} m`),
      ln(`토압 Ea = ½·γ·Ka·H_bw² = ½×${soil.gamma}×${Ka.toFixed(3)}×${geom.backwallHeight}²`, `${Ea_bw_tri.toFixed(2)} kN/m`),
      ln(`상재 Ea_q = q·Ka·H_bw = ${load.surcharge}×${Ka.toFixed(3)}×${geom.backwallHeight}`, `${Ea_bw_sur.toFixed(2)} kN/m`),
      ln(`Mu = Ea×H/3 + Ea_q×H/2`, `${Mu_bw_kNm.toFixed(2)} kN·m/m`),
      ln(`As = D${bwReb.mainDia}@${bwReb.mainSpacing} → ${As_bw.toFixed(0)} mm²/m`),
      ln(`φMn`, `${phiMn_bw.toFixed(2)} kN·m/m`, 0, 'result'),
      verdict(ok_bw, Mu_bw_kNm, phiMn_bw, 'kN·m/m'),
    ]
    if (!ok_bw) warns.push('흉벽 휨 강도 부족')
    items.push({
      id: 'backwall-flex', label: '흉벽 휨강도', demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Mu_bw_kNm, capacity: phiMn_bw, unit: 'kN·m/m',
      SF: phiMn_bw / Mu_bw_kNm, ratio: Mu_bw_kNm / phiMn_bw,
      status: ok_bw ? 'OK' : 'NG',
      formula: 'Mu ≤ φMn (흉벽 캔틸레버)',
      detail: {}, steps,
    })
  }

  const overallStatus: CheckStatus = items.some(i => i.status === 'NG')
    ? 'NG' : items.some(i => i.status === 'WARN') ? 'WARN' : 'OK'

  return {
    moduleId: 'abutment',
    items,
    overallStatus,
    maxRatio: Math.max(...items.map(i => i.ratio)),
    warnings: warns,
  }
}

// ── SVG 교대 단면도 ──────────────────────────────────────────────
function AbutmentDiagram({ geom, stemReb, footReb, bwReb }: {
  geom: AbutmentGeom
  stemReb: StemRebar
  footReb: FootRebar
  bwReb: BackwallRebar
}) {
  const W = 520; const H = 480
  const pad = { l: 60, r: 80, t: 50, b: 60 }
  const drawW = W - pad.l - pad.r
  const drawH = H - pad.t - pad.b

  // 스케일: 폭 방향
  const totalW_m = geom.footWidth + 1.0  // 약간 여유
  const totalH_m = geom.stemHeight + geom.backwallHeight + geom.footThick / 1000 + 0.5

  const scaleX = drawW / totalW_m
  const scaleY = drawH / totalH_m

  const ox = pad.l          // 기초 앞굽 좌측 X
  const oy = pad.t          // 최상단 Y (흉벽 상단)

  // 좌표 변환
  const tx = (xm: number) => ox + xm * scaleX
  const ty = (ym: number) => oy + ym * scaleY  // y=0이 최상단

  const stemThickBot_m = geom.stemThickBot / 1000
  const stemThickTop_m = geom.stemThickTop / 1000
  const bwThick_m = geom.backwallThick / 1000
  const footThick_m = geom.footThick / 1000
  const footToe = geom.footToe
  const footHeel = geom.footHeel

  // 기준점 (top of footing → y방향)
  const y_top_bw   = 0
  const y_bot_bw   = geom.backwallHeight
  const y_bot_stem = geom.backwallHeight + geom.stemHeight
  const y_bot_foot = y_bot_stem + footThick_m

  // 흉벽 X 위치 (줄기 위에 위치)
  const x_stem_L  = footToe
  const x_stem_R  = footToe + stemThickBot_m
  const x_stemT_L = footToe + (stemThickBot_m - stemThickTop_m) / 2
  const x_stemT_R = x_stemT_L + stemThickTop_m
  const x_bw_L    = footToe + (stemThickBot_m - bwThick_m) / 2
  const x_bw_R    = x_bw_L + bwThick_m
  const x_foot_L  = 0
  const x_foot_R  = geom.footWidth

  // 철근 그리기 헬퍼
  const COV_S = stemReb.cover / 1000
  const COV_F = footReb.cover / 1000

  // 줄기 주근 (인장측 = 앞면)
  const stemBarX = tx(x_stem_L + COV_S + stemReb.mainDia / 2000)
  const stemBarCount = Math.min(5, Math.floor((geom.stemHeight * 1000 / stemReb.mainSpacing)))
  const stemBars = Array.from({ length: stemBarCount }, (_, i) => {
    const yRel = y_bot_bw + (geom.stemHeight / (stemBarCount + 1)) * (i + 1)
    return ty(yRel)
  })

  // 뒷굽 상단 철근
  const heelBarY   = ty(y_bot_stem + COV_F + footReb.heelDia / 2000)
  const heelBarX0  = tx(x_stem_R + 0.1)
  const heelBarX1  = tx(x_foot_R - COV_F)

  // 앞굽 하단 철근
  const toeBarY   = ty(y_bot_foot - COV_F - footReb.toeDia / 2000)
  const toeBarX0  = tx(x_foot_L + COV_F)
  const toeBarX1  = tx(x_stem_L - 0.1)

  // 치수 표시 헬퍼
  const dimColor = '#1a56b0'

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fff' }}>
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={dimColor}/>
        </marker>
        <marker id="arrR" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto-start-reverse">
          <path d="M0,0 L6,3 L0,6 Z" fill={dimColor}/>
        </marker>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#8b6914" strokeWidth="1.2" strokeOpacity="0.35"/>
        </pattern>
      </defs>

      {/* 제목 */}
      <text x={W/2} y={22} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1e2a3a">
        역T형 교대 단면도 (단위폭 {geom.unitWidth}m 검토)
      </text>

      {/* ── 지반 (사선 해치) ── */}
      <rect
        x={tx(x_foot_R)} y={ty(y_top_bw)}
        width={pad.r - 10} height={ty(y_bot_stem) - ty(y_top_bw)}
        fill="url(#hatch)" opacity={0.7}
      />
      {/* 지표선 */}
      <line x1={tx(x_foot_R)} y1={ty(y_bot_bw)} x2={tx(x_foot_R)+pad.r-10} y2={ty(y_bot_bw)}
        stroke="#6b4f1a" strokeWidth="1.5" strokeDasharray="4,2"/>
      <text x={tx(x_foot_R)+4} y={ty(y_bot_bw)-4} fontSize="8" fill="#6b4f1a">지표면</text>

      {/* ── 기초 하면 지반 ── */}
      <rect
        x={tx(x_foot_L)} y={ty(y_bot_foot)}
        width={(geom.footWidth)*scaleX} height={20}
        fill="url(#hatch)" opacity={0.5}
      />
      <line x1={tx(x_foot_L)} y1={ty(y_bot_foot)} x2={tx(x_foot_R)} y2={ty(y_bot_foot)}
        stroke="#6b4f1a" strokeWidth="2"/>

      {/* ── 콘크리트 몸체 ── */}
      {/* 기초판 */}
      <rect
        x={tx(x_foot_L)} y={ty(y_bot_stem)}
        width={(x_foot_R - x_foot_L)*scaleX} height={footThick_m*scaleY}
        fill="#e8eef6" stroke="#2c3e70" strokeWidth="1.5"
      />
      {/* 줄기 (사다리꼴) */}
      <polygon
        points={[
          `${tx(x_stemT_L)},${ty(y_bot_bw)}`,
          `${tx(x_stemT_R)},${ty(y_bot_bw)}`,
          `${tx(x_stem_R)},${ty(y_bot_stem)}`,
          `${tx(x_stem_L)},${ty(y_bot_stem)}`,
        ].join(' ')}
        fill="#e8eef6" stroke="#2c3e70" strokeWidth="1.5"
      />
      {/* 흉벽 */}
      <rect
        x={tx(x_bw_L)} y={ty(y_top_bw)}
        width={bwThick_m*scaleX} height={geom.backwallHeight*scaleY}
        fill="#e8eef6" stroke="#2c3e70" strokeWidth="1.5"
      />

      {/* ── 토압 화살표 ── */}
      {[0.2, 0.45, 0.7].map((frac, i) => {
        const arrowY = ty(y_bot_bw + geom.stemHeight * frac)
        const arrowLen = 20 + frac * 30
        return (
          <g key={i}>
            <line
              x1={tx(x_foot_R) + arrowLen} y1={arrowY}
              x2={tx(x_stemT_R) + 4} y2={arrowY}
              stroke="#c0392b" strokeWidth="1.5"
              markerEnd="url(#arr)"
            />
          </g>
        )
      })}
      <text x={tx(x_foot_R) + 38} y={ty(y_bot_bw + geom.stemHeight * 0.25)} fontSize="9" fill="#c0392b" fontWeight="700">토압</text>

      {/* 상부 수직 반력 */}
      <line
        x1={tx(x_stemT_L + stemThickTop_m/2)} y1={ty(y_top_bw) - 28}
        x2={tx(x_stemT_L + stemThickTop_m/2)} y2={ty(y_top_bw) - 4}
        stroke="#1a7a3c" strokeWidth="2" markerEnd="url(#arr)"
      />
      <text x={tx(x_stemT_L + stemThickTop_m/2) - 2} y={ty(y_top_bw) - 30}
        fontSize="8" fill="#1a7a3c" textAnchor="middle">P_D+L</text>

      {/* ── 철근 ── */}
      {/* 줄기 인장 주근 (앞면) */}
      {stemBars.map((yb, i) => (
        <circle key={i} cx={stemBarX} cy={yb} r={Math.max(2.5, stemReb.mainDia/10)} fill="#c0392b" stroke="#7b1b0a" strokeWidth="0.5"/>
      ))}
      {/* 줄기 압축 주근 (뒷면) */}
      {stemBars.map((yb, i) => (
        <circle key={i} cx={tx(x_stemT_R - COV_S - stemReb.mainDia/2000)} cy={yb}
          r={Math.max(2, stemReb.mainDia/12)} fill="#2980b9" stroke="#1a5276" strokeWidth="0.5"/>
      ))}
      {/* 뒷굽 상단 철근 */}
      <line x1={heelBarX0} y1={heelBarY} x2={heelBarX1} y2={heelBarY}
        stroke="#c0392b" strokeWidth={Math.max(2, footReb.heelDia/8)} strokeLinecap="round"/>
      {/* 앞굽 하단 철근 */}
      <line x1={toeBarX0} y1={toeBarY} x2={toeBarX1} y2={toeBarY}
        stroke="#c0392b" strokeWidth={Math.max(2, footReb.toeDia/8)} strokeLinecap="round"/>
      {/* 흉벽 주근 */}
      <line x1={tx(x_bw_L + bwReb.cover/1000 + bwReb.mainDia/2000)} y1={ty(y_top_bw + 0.05)}
        x2={tx(x_bw_L + bwReb.cover/1000 + bwReb.mainDia/2000)} y2={ty(y_bot_bw - 0.05)}
        stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round"/>

      {/* ── 치수선 ── */}
      {/* 전체 기초폭 */}
      <line x1={tx(x_foot_L)} y1={ty(y_bot_foot)+28} x2={tx(x_foot_R)} y2={ty(y_bot_foot)+28}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_foot_L + geom.footWidth/2)} y={ty(y_bot_foot)+40}
        textAnchor="middle" fontSize="9" fill={dimColor}>B = {geom.footWidth.toFixed(1)}m</text>

      {/* 앞굽 */}
      <line x1={tx(x_foot_L)} y1={ty(y_bot_foot)+14} x2={tx(x_stem_L)} y2={ty(y_bot_foot)+14}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_foot_L + footToe/2)} y={ty(y_bot_foot)+12}
        textAnchor="middle" fontSize="8" fill={dimColor}>L₁={footToe}m</text>

      {/* 뒷굽 */}
      <line x1={tx(x_stem_R)} y1={ty(y_bot_foot)+14} x2={tx(x_foot_R)} y2={ty(y_bot_foot)+14}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_stem_R + footHeel/2)} y={ty(y_bot_foot)+12}
        textAnchor="middle" fontSize="8" fill={dimColor}>L₂={footHeel}m</text>

      {/* 줄기 높이 */}
      <line x1={tx(x_foot_L)-20} y1={ty(y_bot_bw)} x2={tx(x_foot_L)-20} y2={ty(y_bot_stem)}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_foot_L)-22} y={ty(y_bot_bw + geom.stemHeight/2)}
        textAnchor="end" fontSize="9" fill={dimColor}>H={geom.stemHeight}m</text>

      {/* 기초 두께 */}
      <line x1={tx(x_foot_L)-20} y1={ty(y_bot_stem)} x2={tx(x_foot_L)-20} y2={ty(y_bot_foot)}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_foot_L)-22} y={ty(y_bot_stem + footThick_m/2)}
        textAnchor="end" fontSize="8" fill={dimColor}>t={geom.footThick}mm</text>

      {/* 흉벽 높이 */}
      <line x1={tx(x_bw_R)+6} y1={ty(y_top_bw)} x2={tx(x_bw_R)+6} y2={ty(y_bot_bw)}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_bw_R)+8} y={ty(y_top_bw + geom.backwallHeight/2)}
        fontSize="8" fill={dimColor}>H_bw={geom.backwallHeight}m</text>

      {/* 줄기 하단 두께 */}
      <line x1={tx(x_stem_L)} y1={ty(y_bot_stem)-6} x2={tx(x_stem_R)} y2={ty(y_bot_stem)-6}
        stroke={dimColor} strokeWidth="0.8" markerStart="url(#arrR)" markerEnd="url(#arr)"/>
      <text x={tx(x_stem_L + stemThickBot_m/2)} y={ty(y_bot_stem)-8}
        textAnchor="middle" fontSize="8" fill={dimColor}>{geom.stemThickBot}mm</text>

      {/* 철근 범례 */}
      <g transform={`translate(${W-110}, ${pad.t+10})`}>
        <rect width="106" height="62" fill="white" stroke="#ccc" strokeWidth="0.8" rx="2"/>
        <text x="5" y="12" fontSize="8" fontWeight="700" fill="#333">[ 철근 범례 ]</text>
        <circle cx="10" cy="24" r="3" fill="#c0392b"/>
        <text x="17" y="27" fontSize="8" fill="#333">인장주근 D{stemReb.mainDia}@{stemReb.mainSpacing}</text>
        <circle cx="10" cy="36" r="2.5" fill="#2980b9"/>
        <text x="17" y="39" fontSize="8" fill="#333">압축주근 D{stemReb.mainDia}</text>
        <line x1="5" y1="48" x2="17" y2="48" stroke="#c0392b" strokeWidth="2"/>
        <text x="20" y="51" fontSize="8" fill="#333">기초 철근 D{footReb.heelDia}</text>
        <line x1="5" y1="58" x2="17" y2="58" stroke="#c0392b" strokeWidth="2"/>
        <text x="20" y="61" fontSize="8" fill="#333">앞굽 철근 D{footReb.toeDia}</text>
      </g>

      {/* 적용 기준 */}
      <text x={pad.l} y={H-8} fontSize="7.5" fill="#888">
        KDS 14 20 00 : 2025 / KDS 11 50 15 / 도로설계편람 교량편 (국토교통부)
      </text>
    </svg>
  )
}

// ── 입력 섹션 공통 스타일 ─────────────────────────────────────────
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
export default function AbutmentPanel() {
  const { isDesktop } = useResponsive()
  const [tab, setTab] = useState<'input' | 'diagram' | 'result'>('diagram')

  const [geom, setGeom]       = useState<AbutmentGeom>(DEF_GEOM)
  const [mat, setMat]         = useState<AbutmentMaterial>(DEF_MAT)
  const [soil, setSoil]       = useState<SoilParam>(DEF_SOIL)
  const [load, setLoad]       = useState<AbutmentLoad>(DEF_LOAD)
  const [stemReb, setStemReb] = useState<StemRebar>(DEF_STEM_REB)
  const [footReb, setFootReb] = useState<FootRebar>(DEF_FOOT_REB)
  const [bwReb, setBwReb]     = useState<BackwallRebar>(DEF_BW_REB)
  const [result, setResult]   = useState<CheckResult | null>(null)

  const g = useCallback(<K extends keyof AbutmentGeom>(k: K, v: AbutmentGeom[K]) =>
    setGeom(p => ({ ...p, [k]: v })), [])
  const m = useCallback(<K extends keyof AbutmentMaterial>(k: K, v: AbutmentMaterial[K]) =>
    setMat(p => ({ ...p, [k]: v })), [])
  const s = useCallback(<K extends keyof SoilParam>(k: K, v: SoilParam[K]) =>
    setSoil(p => ({ ...p, [k]: v })), [])
  const l = useCallback(<K extends keyof AbutmentLoad>(k: K, v: AbutmentLoad[K]) =>
    setLoad(p => ({ ...p, [k]: v })), [])
  const sr = useCallback(<K extends keyof StemRebar>(k: K, v: StemRebar[K]) =>
    setStemReb(p => ({ ...p, [k]: v })), [])
  const fr = useCallback(<K extends keyof FootRebar>(k: K, v: FootRebar[K]) =>
    setFootReb(p => ({ ...p, [k]: v })), [])
  const br = useCallback(<K extends keyof BackwallRebar>(k: K, v: BackwallRebar[K]) =>
    setBwReb(p => ({ ...p, [k]: v })), [])

  const handleCalc = () => {
    setResult(calcAbutment(geom, mat, soil, load, stemReb, footReb, bwReb))
    if (!isDesktop) setTab('result')
  }

  // ── 탭 버튼 ─────────────────────────────────────────────────
  const tabBtn = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} style={{
      padding: '0.25rem 0.8rem', fontSize: '0.75rem', fontWeight: tab === t ? 700 : 500,
      background: tab === t ? 'var(--primary)' : 'var(--surface-2)',
      color: tab === t ? '#fff' : 'var(--text-2)',
      border: '1px solid var(--border-dark)', borderRadius: '2px', cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
    }}>{label}</button>
  )

  // ── 입력 패널 ────────────────────────────────────────────────
  const InputPanel = (
    <div style={{ padding: '0.6rem 0.75rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      <div style={S.secTitle}>재료</div>
      <div style={S.row3}>
        <Field label="fck" unit="MPa" value={mat.fck} onChange={v => m('fck', v)}/>
        <Field label="fy" unit="MPa" value={mat.fy} onChange={v => m('fy', v)}/>
        <Field label="γc" unit="kN/m³" value={mat.gammaConcrete} onChange={v => m('gammaConcrete', v)}/>
      </div>

      <div style={S.secTitle}>교대 제원</div>
      <div style={S.row}>
        <Field label="전면벽 높이" unit="m" value={geom.stemHeight} onChange={v => g('stemHeight', v)} step={0.1}/>
        <Field label="전면벽 상단 두께" unit="mm" value={geom.stemThickTop} onChange={v => g('stemThickTop', v)}/>
      </div>
      <div style={S.row}>
        <Field label="전면벽 하단 두께" unit="mm" value={geom.stemThickBot} onChange={v => g('stemThickBot', v)}/>
        <Field label="흉벽 높이" unit="m" value={geom.backwallHeight} onChange={v => g('backwallHeight', v)} step={0.1}/>
      </div>
      <div style={S.row}>
        <Field label="흉벽 두께" unit="mm" value={geom.backwallThick} onChange={v => g('backwallThick', v)}/>
        <Field label="기초판 두께" unit="mm" value={geom.footThick} onChange={v => g('footThick', v)}/>
      </div>
      <div style={S.row3}>
        <Field label="기초폭 B" unit="m" value={geom.footWidth} onChange={v => g('footWidth', v)} step={0.1}/>
        <Field label="앞굽 L₁" unit="m" value={geom.footToe} onChange={v => g('footToe', v)} step={0.1}/>
        <Field label="뒷굽 L₂" unit="m" value={geom.footHeel} onChange={v => g('footHeel', v)} step={0.1}/>
      </div>

      <div style={S.secTitle}>토질 및 지반</div>
      <div style={S.row}>
        <Field label="흙 단위중량" unit="kN/m³" value={soil.gamma} onChange={v => s('gamma', v)} step={0.5}/>
        <Field label="내부마찰각 φ" unit="°" value={soil.phi} onChange={v => s('phi', v)} step={1}/>
      </div>
      <div style={S.row}>
        <div>
          <div style={S.label}>Ka 입력방식</div>
          <select style={S.input} value={soil.kaMode}
            onChange={e => s('kaMode', e.target.value as 'auto'|'manual')}>
            <option value="auto">자동 (Rankine)</option>
            <option value="manual">직접입력</option>
          </select>
        </div>
        {soil.kaMode === 'manual'
          ? <Field label="Ka (직접입력)" value={soil.Ka} onChange={v => s('Ka', v)} step={0.001}/>
          : <div>
              <div style={S.label}>Ka (자동)</div>
              <div style={{ ...S.input, background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                {calcKa(soil.phi).toFixed(4)}
              </div>
            </div>
        }
      </div>
      <div style={S.row}>
        <Field label="허용지지력 qa" unit="kPa" value={soil.qa} onChange={v => s('qa', v)}/>
        <Field label="기초 마찰계수 μ" value={soil.muBase} onChange={v => s('muBase', v)} step={0.05}/>
      </div>

      <div style={S.secTitle}>하중</div>
      <div style={S.row}>
        <Field label="고정하중 반력 P_D" unit="kN/m" value={load.PDead} onChange={v => l('PDead', v)}/>
        <Field label="활하중 반력 P_L" unit="kN/m" value={load.PLive} onChange={v => l('PLive', v)}/>
      </div>
      <div style={S.row}>
        <Field label="브레이킹 하중" unit="kN/m" value={load.braking} onChange={v => l('braking', v)}/>
        <Field label="풍하중 수평" unit="kN/m" value={load.windH} onChange={v => l('windH', v)}/>
      </div>
      <div style={S.row}>
        <Field label="온도·건조수축" unit="kN/m" value={load.tempH} onChange={v => l('tempH', v)}/>
        <Field label="상재하중 q" unit="kPa" value={load.surcharge} onChange={v => l('surcharge', v)}/>
      </div>
      <div style={S.row}>
        <Field label="설계수위 hw" unit="m" value={load.waterDepth} onChange={v => l('waterDepth', v)} step={0.1}/>
        <Field label="물 단위중량" unit="kN/m³" value={load.gammaWater} onChange={v => l('gammaWater', v)}/>
      </div>

      <div style={S.secTitle}>전면벽 철근</div>
      <div style={S.row3}>
        <div>
          <div style={S.label}>주근 직경</div>
          <select style={S.input} value={stemReb.mainDia} onChange={e => sr('mainDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <Field label="주근 간격" unit="mm" value={stemReb.mainSpacing} onChange={v => sr('mainSpacing', v)}/>
        <Field label="피복두께" unit="mm" value={stemReb.cover} onChange={v => sr('cover', v)}/>
      </div>

      <div style={S.secTitle}>기초판 철근</div>
      <div style={S.row}>
        <div>
          <div style={S.label}>뒷굽 상단 D</div>
          <select style={S.input} value={footReb.heelDia} onChange={e => fr('heelDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <Field label="뒷굽 간격" unit="mm" value={footReb.heelSpacing} onChange={v => fr('heelSpacing', v)}/>
      </div>
      <div style={S.row}>
        <div>
          <div style={S.label}>앞굽 하단 D</div>
          <select style={S.input} value={footReb.toeDia} onChange={e => fr('toeDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <Field label="앞굽 간격" unit="mm" value={footReb.toeSpacing} onChange={v => fr('toeSpacing', v)}/>
      </div>
      <div style={{ marginBottom: '0.35rem' }}>
        <Field label="기초 피복" unit="mm" value={footReb.cover} onChange={v => fr('cover', v)}/>
      </div>

      <div style={S.secTitle}>흉벽 철근</div>
      <div style={S.row3}>
        <div>
          <div style={S.label}>주근 직경</div>
          <select style={S.input} value={bwReb.mainDia} onChange={e => br('mainDia', +e.target.value)}>
            {REBAR_DIAS.map(d => <option key={d} value={d}>D{d}</option>)}
          </select>
        </div>
        <Field label="주근 간격" unit="mm" value={bwReb.mainSpacing} onChange={v => br('mainSpacing', v)}/>
        <Field label="피복두께" unit="mm" value={bwReb.cover} onChange={v => br('cover', v)}/>
      </div>

      <button onClick={handleCalc} style={{
        marginTop: '0.75rem', width: '100%', padding: '0.5rem',
        background: 'var(--primary)', color: '#fff', border: 'none',
        borderRadius: '2px', fontSize: '0.82rem', fontWeight: 700,
        cursor: 'pointer', fontFamily: 'var(--font-mono)',
      }}>
        ▶ 검토 실행
      </button>
    </div>
  )

  // ── 데스크탑 3패널 ───────────────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
        {/* 좌: 입력 */}
        <div style={{ width: '22rem', minWidth: '22rem', borderRight: '1px solid var(--border-dark)', overflowY: 'auto' }}>
          {InputPanel}
        </div>
        {/* 중: 단면도 */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', padding: '0.5rem' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', marginBottom: '0.3rem', fontFamily: 'var(--font-mono)' }}>
            SECTION DIAGRAM
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <AbutmentDiagram geom={geom} stemReb={stemReb} footReb={footReb} bwReb={bwReb}/>
          </div>
        </div>
        {/* 우: 결과 */}
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

  // ── 모바일 탭 ────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: '0.3rem', padding: '0.4rem 0.6rem', background: 'var(--surface-2)', borderBottom: '1px solid var(--border-dark)' }}>
        {tabBtn('input', '입력')}
        {tabBtn('diagram', '단면도')}
        {tabBtn('result', '결과')}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'input'   && InputPanel}
        {tab === 'diagram' && <div style={{ padding: '0.5rem', background: '#fff' }}><AbutmentDiagram geom={geom} stemReb={stemReb} footReb={footReb} bwReb={bwReb}/></div>}
        {tab === 'result'  && (result ? <ResultTable items={result.items} overallStatus={result.overallStatus}/> : <div style={{ padding: '2rem', color: 'var(--text-3)', fontSize: '0.8rem', textAlign: 'center' }}>검토 실행 후 결과가 표시됩니다</div>)}
      </div>
    </div>
  )
}
