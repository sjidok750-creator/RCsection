import { useState, useRef, useEffect } from 'react'
import type { MaterialInput, CheckResult, CheckItem, CalcLine } from '../../types'
import { useResponsive } from '../../hooks/useResponsive'
import ResultTable from '../common/ResultTable'

// ── 철근 단면적 (공칭) ─────────────────────────────────────────
const REBAR_AREA: Record<number, number> = {
  10: 71.3, 13: 126.7, 16: 198.6, 19: 286.5,
  22: 387.1, 25: 506.7, 29: 642.4, 32: 794.2, 35: 956.6,
}

// ── 기둥 전용 입력 타입 ────────────────────────────────────────
type ColumnShape = 'rectangular' | 'circular' | 'composite'
type TransverseType = 'tie' | 'spiral'

interface ColumnSectionInput {
  shape: ColumnShape
  // Rectangular & composite
  b: number       // 폭 (mm)
  h: number       // 깊이 (mm) — 주축 방향
  // Circular
  D: number       // 직경 (mm)
  // Composite (SRC) — steel section
  steelShape: string   // e.g. 'H-200x200x8x12'
  steelArea: number    // As_steel (mm²)
  steelFy: number      // steel yield strength (MPa)
  // Common
  cover: number   // 피복 두께 (mm)
  coverMode: 'stirrup' | 'center'
}

// 면별 배근 입력 (코너 4개 고정, 각 면은 코너 사이 추가 개수)
interface ColumnRebarInput {
  dia: number          // 주근 직경
  // 직사각형: 각 면 코너 제외 중간 개수
  nTop: number         // 상단 (좌상단~우상단 코너 사이)
  nBot: number         // 하단 (좌하단~우하단 코너 사이)
  nLeft: number        // 좌측 (상단~하단 코너 사이)
  nRight: number       // 우측 (상단~하단 코너 사이)
  // 원형: 총 개수
  nCircular: number
}

interface ColumnTieInput {
  transverseType: TransverseType
  // Tie
  dia: number          // 타이 직경
  spacing: number      // 타이 간격 (mm)
  legs: number         // 다리수
  // Spiral
  spiralDia: number    // spiral bar diameter
  spiralPitch: number  // spiral pitch (mm)
}

interface ColumnLoadInput {
  name: string   // 조합 이름 (예: "최대축력", "최대모멘트")
  Pu: number     // 계수 축력 (kN), 압축 +
  Mux: number    // 계수 휨모멘트 x축 (kN·m)
  Muy: number    // 계수 휨모멘트 y축 (kN·m)
  Vu: number     // 계수 전단력 (kN)
  lu: number     // 비지지 길이 (mm)
  k: number      // 유효길이 계수
}

// ── 기본값 ──────────────────────────────────────────────────
const DEFAULT_MAT: MaterialInput = { fck: 27, fy: 400, Es: 200000 }
const DEFAULT_SEC: ColumnSectionInput = {
  shape: 'rectangular', b: 400, h: 400, D: 500,
  steelShape: 'H-200\u00d7200\u00d78\u00d712', steelArea: 6353, steelFy: 275,
  cover: 40, coverMode: 'stirrup',
}
const DEFAULT_REB: ColumnRebarInput = {
  dia: 22,
  nTop: 2, nBot: 2, nLeft: 0, nRight: 0,
  nCircular: 8,
}
const DEFAULT_TIE: ColumnTieInput = {
  transverseType: 'tie', dia: 10, spacing: 200, legs: 2,
  spiralDia: 10, spiralPitch: 50,
}
const DEFAULT_LOAD: ColumnLoadInput = { name: 'LC1', Pu: 0, Mux: 0, Muy: 0, Vu: 0, lu: 3000, k: 1.0 }

// 기본 4개 조합 — 실무에서 흔히 검토하는 패턴
const DEFAULT_LOADS: ColumnLoadInput[] = [
  { name: 'MAX-P',  Pu: 2000, Mux: 50,  Muy: 0, Vu: 80,  lu: 3000, k: 1.0 },
  { name: 'MAX-M',  Pu: 800,  Mux: 200, Muy: 0, Vu: 120, lu: 3000, k: 1.0 },
  { name: 'MAX-V',  Pu: 1200, Mux: 100, Muy: 0, Vu: 200, lu: 3000, k: 1.0 },
  { name: 'MIN-P',  Pu: 200,  Mux: 150, Muy: 0, Vu: 60,  lu: 3000, k: 1.0 },
]

// ── 면별 배근 헬퍼 ────────────────────────────────────────────
// 직사각형: 코너 4개 + 각 면 중간
function rectRebarCount(reb: ColumnRebarInput): number {
  return 4 + reb.nTop + reb.nBot + reb.nLeft + reb.nRight
}

// 총 개수 (shape 구분)
function totalRebarCount(shape: ColumnShape, reb: ColumnRebarInput): number {
  return shape === 'circular' ? reb.nCircular : rectRebarCount(reb)
}

// 직사각형 단면 철근 위치 배열 (SVG/계산 공용)
// barCenter: 콘크리트 외면~철근 중심 픽셀/스케일 값
// cw, ch: 단면 폭/높이 픽셀/스케일 값
// ox, oy: 단면 좌상단 좌표
function rectRebarPositions(
  reb: ColumnRebarInput,
  ox: number, oy: number,
  cw: number, ch: number,
  barCenter: number,
): { cx: number; cy: number }[] {
  const { nTop, nBot, nLeft, nRight } = reb
  const bars: { cx: number; cy: number }[] = []

  const x0 = ox + barCenter
  const x1 = ox + cw - barCenter
  const y0 = oy + barCenter
  const y1 = oy + ch - barCenter

  // 코너 4개
  bars.push({ cx: x0, cy: y0 })
  bars.push({ cx: x1, cy: y0 })
  bars.push({ cx: x0, cy: y1 })
  bars.push({ cx: x1, cy: y1 })

  // 상단 중간
  for (let i = 1; i <= nTop; i++) {
    bars.push({ cx: x0 + (i / (nTop + 1)) * (x1 - x0), cy: y0 })
  }
  // 하단 중간
  for (let i = 1; i <= nBot; i++) {
    bars.push({ cx: x0 + (i / (nBot + 1)) * (x1 - x0), cy: y1 })
  }
  // 좌측 중간
  for (let i = 1; i <= nLeft; i++) {
    bars.push({ cx: x0, cy: y0 + (i / (nLeft + 1)) * (y1 - y0) })
  }
  // 우측 중간
  for (let i = 1; i <= nRight; i++) {
    bars.push({ cx: x1, cy: y0 + (i / (nRight + 1)) * (y1 - y0) })
  }

  return bars
}

// ── KDS 14 20 20/22 : 기둥 검토 엔진 ──────────────────────────
function calcColumn(
  mat: MaterialInput,
  sec: ColumnSectionInput,
  reb: ColumnRebarInput,
  tie: ColumnTieInput,
  load: ColumnLoadInput,
): CheckResult {
  const { fck, fy, Es } = mat
  const { shape, b, h, D, cover, steelArea: As_steel, steelFy: Fy_steel } = sec
  const { dia: barDia } = reb
  const nBar = totalRebarCount(shape, reb)
  const { transverseType, dia: tieDia, spacing: tieSpacing, legs: tieLegs,
          spiralDia, spiralPitch } = tie
  const { Pu, Mux, Muy, Vu, lu, k } = load

  // ── 횡보강근 직경 (shape-dependent) ──
  const transverseDia = transverseType === 'tie' ? tieDia : spiralDia

  // ── 유효깊이 ──
  let d_prime: number
  let d_val: number
  let Ag: number
  let hMin: number
  let r: number
  let Ig: number
  let bw: number // 전단용 폭

  if (shape === 'circular') {
    d_prime = sec.coverMode === 'center'
      ? cover
      : cover + transverseDia + barDia / 2
    d_val = D - d_prime
    Ag = Math.PI / 4 * D * D
    hMin = D
    r = 0.25 * D
    Ig = Math.PI / 64 * Math.pow(D, 4)
    bw = D
  } else {
    // rectangular or composite
    d_prime = sec.coverMode === 'center'
      ? cover
      : cover + transverseDia + barDia / 2
    d_val = h - d_prime
    Ag = b * h
    hMin = Math.min(b, h)
    r = 0.3 * hMin
    Ig = b * Math.pow(h, 3) / 12
    bw = b
  }

  const Ab = REBAR_AREA[barDia] ?? 0
  const Ast = nBar * Ab

  const beta1 = fck <= 28 ? 0.85 : Math.max(0.85 - 0.007 * (fck - 28), 0.65)
  const ey = fy / Es
  const Ec = 8500 * Math.pow(fck + 4, 1 / 3)

  // ── 축하중 관련 — shape/transverse dependent ──
  const phi_col = transverseType === 'tie' ? 0.65 : 0.70
  const maxAxialFactor = transverseType === 'tie' ? 0.80 : 0.85
  const transverseLabel = transverseType === 'tie' ? '타이 기둥' : '나선 기둥'

  // P0 calculation
  let P0: number
  if (shape === 'composite') {
    P0 = 0.85 * fck * (Ag - Ast - As_steel) + fy * Ast + Fy_steel * As_steel
  } else {
    P0 = 0.85 * fck * (Ag - Ast) + fy * Ast
  }
  const P0_kN = P0 * 1e-3
  const phiPn_max = maxAxialFactor * phi_col * P0_kN

  // 철근비
  const rho_g = Ag > 0 ? Ast / Ag : 0
  const rho_steel = shape === 'composite' && Ag > 0 ? As_steel / Ag : 0

  // 세장비
  const Klu_r = r > 0 ? k * lu / r : Infinity
  const M1_M2 = 0  // 보수적 (단일 곡률)
  const slenderLimit = Math.min(34 - 12 * M1_M2, 40)
  const isSlender = Klu_r > slenderLimit

  // 세장주 모멘트 확대계수
  const bdns = 0.6
  const EI = (0.4 * Ec * Ig) / (1 + bdns)
  const Pc = k * lu > 0 ? Math.PI * Math.PI * EI / Math.pow(k * lu, 2) * 1e-3 : Infinity  // kN
  const Cm = 1.0  // 보수적
  const delta_ns = isSlender
    ? Math.max(Cm / (1 - Pu / (0.75 * Pc)), 1.0)
    : 1.0
  const Mu = Math.sqrt(Mux * Mux + Muy * Muy)  // 합성 모멘트 (간략)
  const Mc = delta_ns * Mu  // 확대된 설계모멘트

  // P-M 상호작용
  // 균형파괴점
  const cb = d_val > 0 ? 0.003 / (0.003 + ey) * d_val : 0
  const ab = beta1 * cb

  // 대칭배근 기둥 — 2면 배근 기준 간략 계산
  const As_half = Ast / 2

  // 균형파괴 축력/모멘트
  const hDim = shape === 'circular' ? D : h  // 단면 깊이 대표값
  const Cc_b = 0.85 * fck * ab * bw * 1e-3  // kN
  const fs_comp_b = cb > 0 ? Es * 0.003 * (cb - d_prime) / cb : 0
  const fs_comp_b_eff = Math.min(fs_comp_b, fy)
  const Cs_b = As_half * (fs_comp_b_eff - 0.85 * fck) * 1e-3
  const Ts_b = As_half * fy * 1e-3
  let Pb = Cc_b + Cs_b - Ts_b
  let Mb = (Cc_b * (hDim / 2 - ab / 2) + Cs_b * (hDim / 2 - d_prime) + Ts_b * (d_val - hDim / 2)) * 1e-3

  // Composite: add steel contribution at balance point
  if (shape === 'composite') {
    // Steel assumed at center — contributes to axial but minimal additional moment
    // Simplified: steel area adds to Pb via (Fy_steel * As_steel * compression factor)
    const steelCompFactor = cb > 0 ? Math.min((cb - hDim / 2) / cb, 1.0) : 0
    const Ps_steel = Fy_steel * As_steel * steelCompFactor * 1e-3
    Pb += Ps_steel
    // Steel moment arm is small (centered) — add minor contribution
    Mb += Math.abs(Ps_steel) * 0.05 * hDim * 1e-3
  }

  const phiPb = phi_col * Pb
  const phiMb = phi_col * Mb

  // 순수 휨 (Pu=0)
  const a0 = bw > 0 ? (As_half * fy) / (0.85 * fck * bw) : 0
  const c0 = beta1 > 0 ? a0 / beta1 : 0
  const fs_comp_0 = c0 > 0 ? Es * 0.003 * (c0 - d_prime) / c0 : 0
  const fs_comp_0_eff = Math.min(Math.abs(fs_comp_0), fy) * Math.sign(fs_comp_0)
  const Cc_0 = 0.85 * fck * a0 * bw * 1e-3
  const Cs_0 = As_half * (fs_comp_0_eff - 0.85 * fck) * 1e-3
  const Mn0 = (Cc_0 * (d_val - a0 / 2) + Cs_0 * (d_val - d_prime)) * 1e-3  // kN·m
  const et0 = c0 > 0 ? 0.003 * (d_val - c0) / c0 : Infinity
  let phi_flex: number
  if (et0 >= 0.005) phi_flex = 0.85
  else if (et0 <= ey) phi_flex = phi_col
  else phi_flex = phi_col + (0.85 - phi_col) * (et0 - ey) / (0.005 - ey)
  const phiMn0 = phi_flex * Mn0

  // 주어진 Pu에 대한 φMn (선형보간 간략법)
  let phiMn: number
  if (Pu >= phiPb) {
    if (phiPn_max - phiPb !== 0) {
      phiMn = phiMb * (phiPn_max - Pu) / (phiPn_max - phiPb)
    } else {
      phiMn = phiMb
    }
  } else {
    if (phiPb !== 0) {
      phiMn = phiMb + (phiMn0 - phiMb) * (phiPb - Pu) / phiPb
    } else {
      phiMn = phiMn0
    }
  }
  phiMn = Math.max(phiMn, 0)
  const SF_pm = Mc > 0 ? phiMn / Mc : Infinity

  // 전단
  const Nu_N = Pu * 1000  // N
  const lambda = 1.0
  const Vc = Ag > 0 && d_val > 0
    ? 0.17 * (1 + Nu_N / (14 * Ag)) * lambda * Math.sqrt(fck) * bw * d_val * 1e-3
    : 0  // kN

  // 전단철근 (tie/spiral 공통 — tie 파라미터 사용)
  const Ab_tie = REBAR_AREA[tieDia] ?? 0
  const Av = tieLegs * Ab_tie
  const Vs = transverseType === 'tie' && tieSpacing > 0
    ? Av * fy * d_val / tieSpacing * 1e-3
    : transverseType === 'spiral' && spiralPitch > 0
    ? (REBAR_AREA[spiralDia] ?? 0) * 2 * fy * d_val / spiralPitch * 1e-3
    : 0  // kN
  const phi_v = 0.75
  const phiVn = phi_v * (Vc + Vs)
  const SF_v = Vu > 0 ? phiVn / Vu : Infinity

  // 타이/나선 간격 관련
  const s_max_16db = 16 * barDia
  const s_max_48dt = 48 * tieDia
  const s_max_dim = hMin
  const s_max = Math.min(s_max_16db, s_max_48dt, s_max_dim)

  // 나선철근 관련
  const Dc = shape === 'circular' ? D - 2 * cover : hMin - 2 * cover  // core diameter
  const Ach = Math.PI / 4 * Dc * Dc
  const Asp = REBAR_AREA[spiralDia] ?? 0
  const rho_s = Dc > 0 && spiralPitch > 0 ? 4 * Asp / (Dc * spiralPitch) : 0
  const fyt = fy  // spiral bar yield strength = fy
  const rho_s_min = Ach > 0 ? 0.45 * (Ag / Ach - 1) * (fck / fyt) : 0
  const spiralPitchOk = spiralPitch >= 25 && spiralPitch <= 75
  const spiralRhoOk = rho_s >= rho_s_min

  // ── CalcLine 헬퍼 ──
  const csec = (text: string): CalcLine => ({ type: 'section', text })
  const eq   = (text: string, value?: string, indent = 0): CalcLine => ({ type: 'eq', text, value, indent })
  const eqk  = (text: string, value?: string, indent = 0): CalcLine => ({ type: 'eq-key', text, value, indent })
  const res  = (text: string, value?: string): CalcLine => ({ type: 'result', text, value })
  const verd = (text: string, ok: boolean): CalcLine => ({ type: 'verdict', text, value: ok ? 'O.K' : 'N.G' })
  const note = (text: string): CalcLine => ({ type: 'note', text })

  // ── Shape-specific label helpers ──
  const shapeLabel = shape === 'rectangular' ? '직사각형' : shape === 'circular' ? '원형' : '합성(SRC)'

  const items: CheckItem[] = [

    // ════════════════════════════════════════════════════════
    // ① 최대 축하중 검토 (Maximum Axial Load)
    // ════════════════════════════════════════════════════════
    {
      id: 'max-axial', label: '① 최대 축하중',
      demandSymbol: 'Pu', capacitySymbol: 'φPn,max',
      demand: Pu, capacity: phiPn_max, unit: 'kN',
      ratio: Pu / phiPn_max, SF: phiPn_max / Pu,
      status: Pu <= phiPn_max ? 'OK' : 'NG',
      formula: `Pu = ${Pu} kN   φPn,max = ${phiPn_max.toFixed(1)} kN   S.F = ${(phiPn_max / Pu).toFixed(3)}`,
      detail: {},
      steps: [
        csec(`1. 총 단면적 Ag  (${shapeLabel})`),
        ...(shape === 'circular'
          ? [
            eq(`Ag = π/4 × D²`, `π/4 × ${D}²`),
            eqk(`Ag`, `${Math.round(Ag).toLocaleString()} mm²`),
          ]
          : [
            eq(`Ag = b × h`, `${b} × ${h}`),
            eqk(`Ag`, `${Ag.toLocaleString()} mm²`),
          ]
        ),

        csec('2. 총 철근 단면적 Ast'),
        eq(`Ab (D${barDia} 1본)`, `${Ab} mm²`),
        eq(`Ast = n × Ab`, `${nBar} × ${Ab}`),
        eqk(`Ast`, `${Math.round(Ast).toLocaleString()} mm²`),

        csec(`3. 순수 압축강도 P₀  (KDS 14 20 20)`),
        ...(shape === 'composite'
          ? [
            note('합성기둥: P₀ = 0.85·fck·(Ag−Ast−As_steel) + fy·Ast + Fy_steel·As_steel'),
            eq(`As_steel`, `${As_steel} mm²`),
            eq(`Fy_steel`, `${Fy_steel} MPa`),
            eq(`P₀ = 0.85×${fck}×(${Math.round(Ag)}−${Math.round(Ast)}−${As_steel}) + ${fy}×${Math.round(Ast)} + ${Fy_steel}×${As_steel}`,
               `${P0_kN.toFixed(1)} kN`),
          ]
          : [
            eq(`P₀ = 0.85·fck·(Ag − Ast) + fy·Ast`,
               `0.85 × ${fck} × (${Math.round(Ag)} − ${Math.round(Ast)}) + ${fy} × ${Math.round(Ast)}`),
          ]
        ),
        eqk(`P₀`, `${P0_kN.toFixed(1)} kN`),

        csec(`4. 최대 설계축하중 φPn,max  (${transverseLabel})`),
        note(`φPn,max = ${maxAxialFactor.toFixed(2)} × φ × P₀  (φ = ${phi_col.toFixed(2)}, ${transverseLabel})`),
        eq(`φPn,max = ${maxAxialFactor.toFixed(2)} × ${phi_col.toFixed(2)} × ${P0_kN.toFixed(1)}`,
           `${phiPn_max.toFixed(1)} kN`),
        eqk(`φPn,max`, `${phiPn_max.toFixed(1)} kN`),

        csec('5. 검토'),
        res(`Pu = ${Pu} kN`, `φPn,max = ${phiPn_max.toFixed(1)} kN`),
        verd(`Pu ${Pu <= phiPn_max ? '≤' : '>'} φPn,max  →  S.F = ${(phiPn_max / Pu).toFixed(3)}`, Pu <= phiPn_max),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ② 철근비 검토 (Reinforcement Ratio)
    // ════════════════════════════════════════════════════════
    {
      id: 'rho-column', label: '② 철근비 검토',
      demandSymbol: 'ρg', capacitySymbol: '0.01~0.08',
      demand: rho_g, capacity: 0.08, unit: '',
      ratio: rho_g < 0.01 ? 0.001 : rho_g / 0.08,
      SF: rho_g < 0.01 ? 0 : rho_g <= 0.08 ? 0.08 / rho_g : 0,
      status: (rho_g >= 0.01 && rho_g <= 0.08
        && (shape !== 'composite' || rho_steel <= 0.08))
        ? 'OK' : 'NG',
      formula: `ρg = ${rho_g.toFixed(5)}   (0.01 ≤ ρg ≤ 0.08)${shape === 'composite' ? `   ρ_steel = ${rho_steel.toFixed(5)}` : ''}`,
      detail: {},
      steps: [
        csec('1. 총 철근비  (KDS 14 20 20  8.4절)'),
        eq(`ρg = Ast / Ag`, `${Math.round(Ast)} / ${Math.round(Ag)}`),
        eqk(`ρg`, `${rho_g.toFixed(5)}`),

        ...(shape === 'composite'
          ? [
            csec('1-1. 강재비 (합성기둥)'),
            eq(`ρ_steel = As_steel / Ag`, `${As_steel} / ${Math.round(Ag)}`),
            eqk(`ρ_steel`, `${rho_steel.toFixed(5)}`),
            note('합성기둥: As_steel/Ag ≤ 0.08'),
            verd(`ρ_steel = ${rho_steel.toFixed(5)} ${rho_steel <= 0.08 ? '≤' : '>'} 0.08`, rho_steel <= 0.08),
          ]
          : []
        ),

        csec('2. 허용 범위'),
        note('KDS 14 20 20  8.4절: 0.01 ≤ ρg ≤ 0.08'),
        eq(`ρg,min`, `0.01  (1%)`),
        eq(`ρg,max`, `0.08  (8%)`),

        csec('3. 검토'),
        res(`ρg = ${rho_g.toFixed(5)}`, `범위: 0.01 ~ 0.08`),
        verd(
          rho_g < 0.01
            ? `ρg = ${rho_g.toFixed(5)} < 0.01  →  최소철근비 미달`
            : rho_g > 0.08
            ? `ρg = ${rho_g.toFixed(5)} > 0.08  →  최대철근비 초과`
            : `0.01 ≤ ρg = ${rho_g.toFixed(5)} ≤ 0.08`,
          rho_g >= 0.01 && rho_g <= 0.08,
        ),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ③ 세장비 검토 (Slenderness Check)
    // ════════════════════════════════════════════════════════
    {
      id: 'slenderness', label: '③ 세장비 검토',
      demandSymbol: 'Klu/r', capacitySymbol: 'limit',
      demand: Klu_r, capacity: slenderLimit, unit: '',
      ratio: isFinite(Klu_r) ? Klu_r / slenderLimit : 999, SF: isFinite(Klu_r) ? slenderLimit / Klu_r : 0,
      status: isSlender ? 'WARN' : 'OK',
      formula: isSlender
        ? `Klu/r = ${isFinite(Klu_r) ? Klu_r.toFixed(1) : '∞'} > ${slenderLimit.toFixed(0)}  →  세장주, δns = ${delta_ns.toFixed(3)}, Mc = ${Mc.toFixed(2)} kN·m`
        : `Klu/r = ${isFinite(Klu_r) ? Klu_r.toFixed(1) : '∞'} ≤ ${slenderLimit.toFixed(0)}  →  단주`,
      detail: {},
      steps: [
        csec(`1. 회전반경 r  (KDS 14 20 20  9.6절,  ${shapeLabel})`),
        ...(shape === 'circular'
          ? [
            note('원형 단면: r = 0.25 × D'),
            eq(`D`, `${D} mm`),
            eq(`r = 0.25 × ${D}`, `${r.toFixed(1)} mm`),
          ]
          : [
            note('직사각형 단면: r = 0.3 × min(b, h)  (약축 기준)'),
            eq(`min(b, h)`, `min(${b}, ${h}) = ${hMin} mm`),
            eq(`r = 0.3 × ${hMin}`, `${r.toFixed(1)} mm`),
          ]
        ),
        eqk(`r`, `${r.toFixed(1)} mm`),

        csec('2. 세장비 Klu/r'),
        eq(`K`, `${k}`),
        eq(`lu`, `${lu} mm`),
        eq(`Klu/r = ${k} × ${lu} / ${r.toFixed(1)}`, `${isFinite(Klu_r) ? Klu_r.toFixed(2) : '∞'}`),
        eqk(`Klu/r`, `${isFinite(Klu_r) ? Klu_r.toFixed(2) : '∞'}`),

        csec('3. 단주/세장주 판별'),
        note('M1/M2 = 0 (보수적, 단일 곡률 가정)'),
        eq(`한계 = min(34 − 12·M1/M2, 40)`, `min(34 − 12×${M1_M2}, 40) = ${slenderLimit.toFixed(0)}`),
        eqk(
          `Klu/r = ${isFinite(Klu_r) ? Klu_r.toFixed(2) : '∞'} ${isSlender ? '>' : '≤'} ${slenderLimit.toFixed(0)}`,
          isSlender ? '세장주 (모멘트 확대 필요)' : '단주'
        ),

        ...(isSlender ? [
          csec('4. 좌굴하중 Pc  (오일러 좌굴)'),
          eq(`Ec = 8500·(fck+4)^(1/3)`, `8500 × (${fck}+4)^(1/3) = ${Math.round(Ec)} MPa`),
          ...(shape === 'circular'
            ? [eq(`Ig = π/64·D⁴`, `π/64 × ${D}⁴ = ${(Ig / 1e6).toFixed(1)} × 10⁶ mm⁴`)]
            : [eq(`Ig = b·h³/12`, `${b} × ${h}³ / 12 = ${(Ig / 1e6).toFixed(1)} × 10⁶ mm⁴`)]
          ),
          note('βdns = 0.6 (기본값, 지속하중비)'),
          eq(`EI = 0.4·Ec·Ig / (1+βdns)`, `0.4 × ${Math.round(Ec)} × ${(Ig / 1e6).toFixed(1)}×10⁶ / (1+0.6)`),
          eqk(`EI`, `${(EI / 1e9).toFixed(3)} × 10⁹ N·mm²`),
          eq(`Pc = π²·EI / (Klu)²`, `π² × ${(EI / 1e9).toFixed(3)}×10⁹ / (${k}×${lu})²`),
          eqk(`Pc`, `${isFinite(Pc) ? Pc.toFixed(1) : '∞'} kN`),

          csec('5. 모멘트 확대계수 δns'),
          note('Cm = 1.0 (보수적)'),
          eq(`δns = Cm / (1 − Pu/(0.75·Pc))`, `1.0 / (1 − ${Pu}/(0.75×${isFinite(Pc) ? Pc.toFixed(1) : '∞'}))`),
          eq(`δns`, `${delta_ns.toFixed(4)} (≥ 1.0)`),
          eqk(`δns`, `${delta_ns.toFixed(4)}`),

          csec('6. 확대 설계모멘트 Mc'),
          eq(`Mu = √(Mux² + Muy²)`, `√(${Mux}² + ${Muy}²) = ${Mu.toFixed(2)} kN·m`),
          eq(`Mc = δns × Mu`, `${delta_ns.toFixed(4)} × ${Mu.toFixed(2)}`),
          eqk(`Mc`, `${Mc.toFixed(2)} kN·m`),
        ] : [
          csec('4. 확대 설계모멘트'),
          note('단주 → 모멘트 확대 불필요 (δns = 1.0)'),
          eq(`Mu = √(Mux² + Muy²)`, `√(${Mux}² + ${Muy}²) = ${Mu.toFixed(2)} kN·m`),
          eqk(`Mc = Mu`, `${Mc.toFixed(2)} kN·m`),
        ]),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ④ 축력-휨 상호작용 검토 (P-M Interaction)
    // ════════════════════════════════════════════════════════
    {
      id: 'pm-interaction', label: '④ P-M 상호작용',
      demandSymbol: 'Mc', capacitySymbol: 'φMn',
      demand: Mc, capacity: phiMn, unit: 'kN·m',
      ratio: Mc > 0 ? Mc / phiMn : 0, SF: SF_pm,
      status: Mc <= phiMn ? 'OK' : 'NG',
      formula: `Mc = ${Mc.toFixed(2)} kN·m   φMn = ${phiMn.toFixed(2)} kN·m   S.F = ${(SF_pm === Infinity ? '∞' : SF_pm.toFixed(3))}`,
      detail: {},
      steps: [
        csec('1. 기본 파라미터'),
        eq(`β₁`, `${beta1.toFixed(3)}  (fck = ${fck} MPa)`),
        eq(`εy = fy / Es`, `${fy} / ${Es} = ${ey.toFixed(5)}`),
        eq(`d = ${shape === 'circular' ? 'D' : 'h'} − d'`, `${shape === 'circular' ? D : h} − ${d_prime.toFixed(1)} = ${d_val.toFixed(1)} mm`),
        eq(`d'`, `${d_prime.toFixed(1)} mm`),
        eq(`As (각면) = Ast / 2`, `${Math.round(Ast)} / 2 = ${Math.round(As_half)} mm²`),
        ...(shape === 'circular'
          ? [note(`원형 단면: bw = D = ${D} mm (간략법)`)]
          : []
        ),
        ...(shape === 'composite'
          ? [
            note(`합성기둥: 강재 단면적 As_steel = ${As_steel} mm², Fy = ${Fy_steel} MPa`),
          ]
          : []
        ),

        csec('2. 균형파괴점  (cb, Pb, Mb)'),
        note('cb = 0.003/(0.003+εy) × d'),
        eq(`cb = 0.003/(0.003+${ey.toFixed(5)}) × ${d_val.toFixed(1)}`, `${cb.toFixed(2)} mm`),
        eq(`ab = β₁ × cb`, `${beta1.toFixed(3)} × ${cb.toFixed(2)} = ${ab.toFixed(2)} mm`),
        eq(`Cc,b = 0.85·fck·ab·bw`, `0.85 × ${fck} × ${ab.toFixed(2)} × ${bw} × 10⁻³ = ${Cc_b.toFixed(1)} kN`),
        eq(`fs',b = Es·0.003·(cb−d')/ cb`,
           `${Es}×0.003×(${cb.toFixed(1)}−${d_prime.toFixed(1)})/${cb.toFixed(1)} = ${fs_comp_b.toFixed(1)} MPa`),
        eq(`Cs,b = As'·(fs'−0.85fck)`, `${Math.round(As_half)} × (${fs_comp_b_eff.toFixed(1)}−${(0.85*fck).toFixed(1)}) × 10⁻³ = ${Cs_b.toFixed(1)} kN`),
        eq(`Ts,b = As·fy`, `${Math.round(As_half)} × ${fy} × 10⁻³ = ${Ts_b.toFixed(1)} kN`),
        eqk(`Pb = Cc + Cs − Ts`, `${Cc_b.toFixed(1)} + ${Cs_b.toFixed(1)} − ${Ts_b.toFixed(1)} = ${Pb.toFixed(1)} kN`),
        eqk(`Mb`, `${Mb.toFixed(2)} kN·m`),
        eq(`φPb = ${phi_col.toFixed(2)} × ${Pb.toFixed(1)}`, `${phiPb.toFixed(1)} kN`),
        eq(`φMb = ${phi_col.toFixed(2)} × ${Mb.toFixed(2)}`, `${phiMb.toFixed(2)} kN·m`),

        csec('3. 순수 휨강도 Mn0  (Pu = 0)'),
        eq(`a₀ = As·fy / (0.85·fck·bw)`, `${Math.round(As_half)} × ${fy} / (0.85×${fck}×${bw}) = ${a0.toFixed(2)} mm`),
        eq(`c₀ = a₀/β₁`, `${c0.toFixed(2)} mm`),
        eq(`εt₀ = 0.003·(d−c₀)/c₀`, `${isFinite(et0) ? et0.toFixed(5) : '∞'}`),
        eq(`φ (순수 휨)`, `${phi_flex.toFixed(4)}`),
        eqk(`Mn0`, `${Mn0.toFixed(2)} kN·m`),
        eqk(`φMn0`, `${phiMn0.toFixed(2)} kN·m`),

        csec('4. 주어진 Pu에 대한 φMn  (선형보간)'),
        note(Pu >= phiPb
          ? `Pu = ${Pu} kN ≥ φPb = ${phiPb.toFixed(1)} kN  →  압축지배 구간`
          : `Pu = ${Pu} kN < φPb = ${phiPb.toFixed(1)} kN  →  인장지배 전이구간`),
        ...(Pu >= phiPb
          ? [
            eq(`φMn = φMb × (φPn,max − Pu)/(φPn,max − φPb)`,
               `${phiMb.toFixed(2)} × (${phiPn_max.toFixed(1)} − ${Pu})/(${phiPn_max.toFixed(1)} − ${phiPb.toFixed(1)})`),
          ]
          : [
            eq(`φMn = φMb + (φMn0 − φMb) × (φPb − Pu)/φPb`,
               `${phiMb.toFixed(2)} + (${phiMn0.toFixed(2)} − ${phiMb.toFixed(2)}) × (${phiPb.toFixed(1)} − ${Pu})/${phiPb.toFixed(1)}`),
          ]
        ),
        eqk(`φMn`, `${phiMn.toFixed(2)} kN·m`),

        csec('5. 검토'),
        res(`Mc = ${Mc.toFixed(2)} kN·m`, `φMn = ${phiMn.toFixed(2)} kN·m`),
        verd(`Mc ${Mc <= phiMn ? '≤' : '>'} φMn  →  S.F = ${SF_pm === Infinity ? '∞' : SF_pm.toFixed(3)}`, Mc <= phiMn),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ⑤ 전단 검토 (Shear Check)
    // ════════════════════════════════════════════════════════
    {
      id: 'shear-col', label: '⑤ 전단 검토',
      demandSymbol: 'Vu', capacitySymbol: 'φVn',
      demand: Vu, capacity: phiVn, unit: 'kN',
      ratio: Vu > 0 ? Vu / phiVn : 0, SF: SF_v,
      status: Vu <= phiVn ? 'OK' : 'NG',
      formula: `Vu = ${Vu} kN   φVn = ${phiVn.toFixed(2)} kN   S.F = ${SF_v === Infinity ? '∞' : SF_v.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 축력 고려 콘크리트 전단강도 Vc  (KDS 14 20 22)'),
        note('Vc = 0.17·(1 + Nu/(14Ag))·λ·√fck·bw·d × 10⁻³'),
        eq(`Nu = Pu × 1000`, `${Pu} × 1000 = ${Nu_N.toLocaleString()} N`),
        eq(`Ag`, `${Math.round(Ag).toLocaleString()} mm²`),
        eq(`1 + Nu/(14·Ag)`, `1 + ${Nu_N.toLocaleString()}/(14×${Math.round(Ag).toLocaleString()}) = ${(1 + Nu_N / (14 * Ag)).toFixed(4)}`),
        eq(`λ`, `1.0  (보통콘크리트)`),
        ...(shape === 'circular'
          ? [eq(`bw = D`, `${D} mm  (원형 단면)`)]
          : [eq(`bw = b`, `${b} mm`)]
        ),
        eq(`Vc = 0.17 × ${(1 + Nu_N / (14 * Ag)).toFixed(4)} × 1.0 × √${fck} × ${bw} × ${d_val.toFixed(0)} × 10⁻³`),
        eqk(`Vc`, `${Vc.toFixed(3)} kN`),

        csec('2. 전단철근 강도 Vs'),
        ...(transverseType === 'tie'
          ? [
            eq(`Ab (D${tieDia} 1본)`, `${Ab_tie} mm²`),
            eq(`Av = legs × Ab`, `${tieLegs} × ${Ab_tie} = ${Math.round(Av)} mm²`),
            eq(`Vs = Av·fy·d / s × 10⁻³`, `${Math.round(Av)} × ${fy} × ${d_val.toFixed(0)} / ${tieSpacing} × 10⁻³`),
          ]
          : [
            eq(`Ab (D${spiralDia} 나선)`, `${Asp} mm²`),
            note('나선철근 전단기여: Vs = 2·Asp·fy·d / pitch'),
            eq(`Vs = 2 × ${Asp} × ${fy} × ${d_val.toFixed(0)} / ${spiralPitch} × 10⁻³`),
          ]
        ),
        eqk(`Vs`, `${Vs.toFixed(3)} kN`),

        csec('3. 설계 전단강도 φVn'),
        eq(`φ = ${phi_v}  (전단)`, ``),
        eq(`φVn = φ·(Vc + Vs)`, `${phi_v} × (${Vc.toFixed(3)} + ${Vs.toFixed(3)})`),
        eqk(`φVn`, `${phiVn.toFixed(3)} kN`),

        csec('4. 검토'),
        res(`Vu = ${Vu} kN`, `φVn = ${phiVn.toFixed(2)} kN`),
        verd(`Vu ${Vu <= phiVn ? '≤' : '>'} φVn  →  S.F = ${SF_v === Infinity ? '∞' : SF_v.toFixed(3)}`, Vu <= phiVn),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ⑥ 횡보강근 검토 (Transverse Reinforcement)
    // ════════════════════════════════════════════════════════
    ...(transverseType === 'tie'
      ? [{
        id: 'tie-spacing', label: '⑥ 타이 간격',
        demandSymbol: 's', capacitySymbol: 's_max',
        demand: tieSpacing, capacity: s_max, unit: 'mm',
        ratio: tieSpacing / s_max, SF: s_max / tieSpacing,
        status: (tieSpacing <= s_max ? 'OK' : 'NG') as 'OK' | 'NG' | 'WARN',
        formula: `s = ${tieSpacing} mm   s_max = ${s_max} mm   S.F = ${(s_max / tieSpacing).toFixed(3)}`,
        detail: {},
        steps: [
          csec('1. 최대 타이 간격  (KDS 14 20 20  8.4.3)'),
          note(`s_max = min(16·db, 48·dt, ${shape === 'circular' ? 'D' : 'min(b,h)'})`),
          eq(`16 × db (D${barDia})`, `16 × ${barDia} = ${s_max_16db} mm`),
          eq(`48 × dt (D${tieDia})`, `48 × ${tieDia} = ${s_max_48dt} mm`),
          ...(shape === 'circular'
            ? [eq(`D`, `${D} mm`)]
            : [eq(`min(b, h)`, `min(${b}, ${h}) = ${hMin} mm`)]
          ),
          eqk(`s_max = min(${s_max_16db}, ${s_max_48dt}, ${hMin})`, `${s_max} mm`),

          csec('2. 검토'),
          res(`s = ${tieSpacing} mm`, `s_max = ${s_max} mm`),
          verd(`s ${tieSpacing <= s_max ? '≤' : '>'} s_max  →  S.F = ${(s_max / tieSpacing).toFixed(3)}`, tieSpacing <= s_max),
        ],
      } as CheckItem]
      : [{
        id: 'spiral-check', label: '⑥ 나선철근 검토',
        demandSymbol: 'ρs', capacitySymbol: 'ρs,min',
        demand: rho_s_min, capacity: rho_s, unit: '',
        ratio: rho_s_min > 0 ? rho_s_min / rho_s : 0,
        SF: rho_s > 0 ? rho_s / rho_s_min : 0,
        status: (spiralPitchOk && spiralRhoOk ? 'OK' : 'NG') as 'OK' | 'NG' | 'WARN',
        formula: `pitch = ${spiralPitch} mm   ρs = ${rho_s.toFixed(5)}   ρs,min = ${rho_s_min.toFixed(5)}`,
        detail: {},
        steps: [
          csec('1. 나선철근 피치 검토  (KDS 14 20 20  8.4.4)'),
          note('25mm ≤ pitch ≤ 75mm'),
          eq(`pitch`, `${spiralPitch} mm`),
          verd(`pitch = ${spiralPitch} mm  ${spiralPitchOk ? '→ 25~75mm 범위 내' : '→ 범위 초과'}`, spiralPitchOk),

          csec('2. 코어 직경 Dc'),
          eq(`Dc = ${shape === 'circular' ? 'D' : 'min(b,h)'} − 2×cover`, `${shape === 'circular' ? D : hMin} − 2×${cover} = ${Dc} mm`),
          eq(`Ach = π/4 × Dc²`, `π/4 × ${Dc}² = ${Math.round(Ach)} mm²`),

          csec('3. 나선철근비 ρs'),
          eq(`Asp (D${spiralDia} 1본)`, `${Asp} mm²`),
          eq(`ρs = 4·Asp / (Dc·pitch)`, `4 × ${Asp} / (${Dc} × ${spiralPitch})`),
          eqk(`ρs`, `${rho_s.toFixed(5)}`),

          csec('4. 최소 나선철근비 ρs,min'),
          note('ρs,min = 0.45·(Ag/Ach − 1)·(fck/fyt)'),
          eq(`Ag/Ach`, `${Math.round(Ag)} / ${Math.round(Ach)} = ${(Ag / Ach).toFixed(4)}`),
          eq(`ρs,min = 0.45 × (${(Ag / Ach).toFixed(4)} − 1) × (${fck}/${fyt})`, `${rho_s_min.toFixed(5)}`),
          eqk(`ρs,min`, `${rho_s_min.toFixed(5)}`),

          csec('5. 검토'),
          res(`ρs = ${rho_s.toFixed(5)}`, `ρs,min = ${rho_s_min.toFixed(5)}`),
          verd(`ρs ${spiralRhoOk ? '≥' : '<'} ρs,min  →  ${spiralRhoOk ? 'O.K' : 'N.G'}`, spiralRhoOk),
        ],
      } as CheckItem]
    ),
  ]

  const hasNG = items.some(i => i.status === 'NG')
  const maxRatio = Math.max(...items.map(i => isFinite(i.ratio) ? i.ratio : 0))

  return {
    moduleId: 'rc-column', items,
    overallStatus: hasNG ? 'NG' : maxRatio > 0.9 ? 'WARN' : 'OK',
    maxRatio,
    warnings: [
      ...(isSlender ? [`세장주 — 모멘트 확대계수 δns = ${delta_ns.toFixed(3)} 적용`] : []),
      ...(rho_g < 0.01 ? ['철근비 1% 미만 — 최소 철근비 미달'] : []),
      ...(rho_g > 0.06 ? [`철근비 ${(rho_g * 100).toFixed(1)}% — 시공성 검토 필요`] : []),
      ...(shape === 'composite' && rho_steel > 0.08 ? [`강재비 ${(rho_steel * 100).toFixed(1)}% — 최대 강재비 초과`] : []),
      ...(transverseType === 'spiral' && !spiralPitchOk ? [`나선 피치 ${spiralPitch}mm — 허용범위(25~75mm) 초과`] : []),
    ],
  }
}

// ── P-M 상관도 SVG 컴포넌트 ─────────────────────────────────
// 눈금 간격 자동 계산
function niceStep(range: number, maxTicks: number): number {
  const raw = range / maxTicks
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  return [1, 2, 5, 10].map(f => f * exp).find(s => range / s <= maxTicks) ?? exp
}

function PMDiagram({
  mat, sec, reb, tie, load,
  rho_g,
}: {
  mat: MaterialInput
  sec: ColumnSectionInput
  reb: ColumnRebarInput
  tie: ColumnTieInput
  load: ColumnLoadInput
  rho_g: number
}) {
  // ── 공칭 곡선 & 설계 곡선 분리 생성 ──
  const { fck, fy, Es } = mat
  const { shape, b, h, D, cover } = sec
  const { dia: barDia } = reb
  const nBar = totalRebarCount(shape, reb)
  const { transverseType, dia: tieDia, spiralDia } = tie
  const transverseDia = transverseType === 'tie' ? tieDia : spiralDia
  const Ab = REBAR_AREA[barDia] ?? 0
  const Ast = nBar * Ab
  const As_half = Ast / 2
  const beta1 = fck <= 28 ? 0.85 : Math.max(0.85 - 0.007 * (fck - 28), 0.65)
  const ey = fy / Es
  const phi_col = transverseType === 'tie' ? 0.65 : 0.70
  const maxAxialFactor = transverseType === 'tie' ? 0.80 : 0.85

  let d_prime: number, d_val: number, Ag: number, bw: number, hDim: number
  if (shape === 'circular') {
    d_prime = sec.coverMode === 'center' ? cover : cover + transverseDia + barDia / 2
    d_val = D - d_prime; Ag = Math.PI / 4 * D * D; bw = D; hDim = D
  } else {
    d_prime = sec.coverMode === 'center' ? cover : cover + transverseDia + barDia / 2
    d_val = h - d_prime; Ag = b * h; bw = b; hDim = h
  }
  const As_steel = shape === 'composite' ? sec.steelArea : 0
  const Fy_steel = shape === 'composite' ? sec.steelFy : 0
  const P0 = shape === 'composite'
    ? 0.85 * fck * (Ag - Ast - As_steel) + fy * Ast + Fy_steel * As_steel
    : 0.85 * fck * (Ag - Ast) + fy * Ast
  const Pn_max = P0 * 1e-3  // 공칭 최대 축력
  const phiPn_max = maxAxialFactor * phi_col * Pn_max

  // 공통 포인트 계산 (c 순회)
  type RawPt = { Pn: number; Mn: number; phi: number; et: number }
  const rawPts: RawPt[] = []
  const steps = 80
  for (let i = 0; i <= steps; i++) {
    const c = d_val * 2.5 * (1 - i / steps) + 0.001
    const a = Math.min(beta1 * c, hDim)
    const Cc = 0.85 * fck * a * bw * 1e-3
    const fs_c = Math.max(Math.min(Es * 0.003 * (c - d_prime) / c, fy), -fy)
    const Cs = As_half * (fs_c - 0.85 * fck) * 1e-3
    const fs_t = Math.max(Math.min(0.003 * (d_val - c) / c * Es, fy), -fy)
    const Ts = As_half * fs_t * 1e-3
    let Ps = 0
    if (shape === 'composite') {
      Ps = (c > hDim / 2 ? 1 : -1) * Fy_steel * As_steel * 1e-3
    }
    const Pn = Cc + Cs - Ts + Ps
    const Mn = Math.max((Cc * (hDim / 2 - a / 2) + Cs * (hDim / 2 - d_prime) + Ts * (d_val - hDim / 2)) * 1e-3, 0)
    const et = 0.003 * (d_val - c) / c
    let phi: number
    if (et >= 0.005) phi = 0.85
    else if (et <= ey) phi = phi_col
    else phi = phi_col + (0.85 - phi_col) * (et - ey) / (0.005 - ey)
    rawPts.push({ Pn, Mn, phi, et })
  }
  // 순수인장
  rawPts.push({ Pn: -fy * Ast * 1e-3, Mn: 0, phi: 0.90, et: Infinity })

  // 공칭 곡선 (파랑)
  interface CurvePoint { P: number; M: number }
  const nominalCurve: CurvePoint[] = [
    { P: Pn_max, M: 0 },
    ...rawPts.map(p => ({ P: Math.min(p.Pn, Pn_max), M: p.Mn })),
  ]
  // 설계 곡선 (빨강)
  const designCurve: CurvePoint[] = [
    { P: phiPn_max, M: 0 },
    ...rawPts.map(p => ({ P: Math.min(p.phi * p.Pn, phiPn_max), M: Math.max(p.phi * p.Mn, 0) })),
  ]

  // 균형파괴점 (설계곡선 기준 M 최대점)
  const balIdx = designCurve.reduce((bi, pt, i) => pt.M > designCurve[bi].M ? i : bi, 0)
  const balPt = designCurve[balIdx]

  // 하중점
  const Pu = load.Pu
  const Mu = Math.sqrt(load.Mux ** 2 + load.Muy ** 2)

  // 편심 e = Mu/Pu, 편심 직선: P = Pu/Mu * M (원점 통과)
  const ecc = Pu > 0 && Mu > 0 ? Mu / Pu : null  // m 단위로 보면 kN·m/kN = m

  // 설계 곡선에서 해당 편심선과의 교점 → φPn, φMn
  // 편심선: P = (Pu/Mu)*M  ↔  각도 θ = atan(Pu/Mu)
  // 곡선 각 구간에서 교점 탐색
  let capPt: CurvePoint | null = null
  if (Mu > 0 && Pu >= 0) {
    const slope = Pu / Mu  // P/M 비율
    for (let i = 1; i < designCurve.length; i++) {
      const a = designCurve[i - 1], b2 = designCurve[i]
      // 구간 내 P = slope * M 교점
      const dM = b2.M - a.M, dP = b2.P - a.P
      if (Math.abs(dM * slope - dP) < 1e-9) continue
      const t = (slope * a.M - a.P) / (dP - slope * dM)
      if (t >= 0 && t <= 1) {
        const iM = a.M + t * dM
        const iP = a.P + t * dP
        if (iM >= 0 && iP >= 0) { capPt = { P: iP, M: iM }; break }
      }
    }
  }

  // SF = capPt.P / Pu (같은 편심에서 capacity / demand)
  const SF = capPt && Pu > 0 ? capPt.P / Pu : (capPt ? Infinity : null)

  // 내부/외부 판정
  const inside = capPt ? Pu <= capPt.P : false

  // ── 좌표 범위 ──
  const allP = [...nominalCurve.map(p => p.P), ...designCurve.map(p => p.P), Pu]
  const allM = [...nominalCurve.map(p => p.M), ...designCurve.map(p => p.M), Mu]
  const maxPraw = Math.max(...allP)
  const minPraw = Math.min(...allP, -maxPraw * 0.15)
  const maxMraw = Math.max(...allM) * 1.05 || 100

  const pStep = niceStep(maxPraw - minPraw, 7)
  const pMin = Math.floor(minPraw / pStep) * pStep
  const pMax = Math.ceil(maxPraw / pStep + 0.5) * pStep
  const mStep = niceStep(maxMraw, 6)
  const mMax = Math.ceil(maxMraw / mStep + 0.3) * mStep

  // SVG 크기 — viewBox만 고정, 실제 렌더링은 100%
  const VW = 400, VH = 320
  const padL = 52, padR = 12, padT = 10, padB = 28
  const W = VW - padL - padR
  const H = VH - padT - padB

  const toX = (m: number) => padL + (m / mMax) * W
  const toY = (p: number) => padT + H - ((p - pMin) / (pMax - pMin)) * H

  const makePath = (pts: CurvePoint[]) =>
    pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${toX(pt.M).toFixed(1)},${toY(pt.P).toFixed(1)}`).join(' ')

  const nomPath = makePath(nominalCurve)
  const desPath = makePath(designCurve)

  // 눈금
  const pTicks: number[] = []
  for (let v = Math.ceil(pMin / pStep) * pStep; v <= pMax + 1; v += pStep) pTicks.push(Math.round(v))
  const mTicks: number[] = []
  for (let v = 0; v <= mMax + 1; v += mStep) mTicks.push(Math.round(v))

  const fmt = (v: number) => Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`

  // 편심선 끝점 (플롯 경계까지)
  const eccLineEnd: CurvePoint | null = ecc && Pu > 0
    ? (() => {
        const slope = Pu / Mu
        const mEnd = Math.min(mMax, pMax / slope)
        return { M: mEnd, P: slope * mEnd }
      })()
    : null

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}>
      <defs>
        <clipPath id="pm-clip2">
          <rect x={padL} y={padT} width={W} height={H}/>
        </clipPath>
      </defs>

      {/* 배경 */}
      <rect x={padL} y={padT} width={W} height={H} fill="#ffffff"/>

      {/* ── 격자선 (촘촘) ── */}
      {pTicks.map(v => {
        const y = toY(v); if (y < padT - 1 || y > padT + H + 1) return null
        return <line key={`pg-${v}`} clipPath="url(#pm-clip2)"
          x1={padL} y1={y} x2={padL + W} y2={y}
          stroke={v === 0 ? '#8898b0' : '#dde3ec'} strokeWidth={v === 0 ? 1 : 0.5}
          strokeDasharray={v === 0 ? '4 3' : undefined}/>
      })}
      {mTicks.map(v => (
        <line key={`mg-${v}`} clipPath="url(#pm-clip2)"
          x1={toX(v)} y1={padT} x2={toX(v)} y2={padT + H}
          stroke={v === 0 ? '#8898b0' : '#dde3ec'} strokeWidth="0.5"/>
      ))}

      {/* ── 편심 직선 (원점 → 하중점 방향, 빨간 점선) ── */}
      {eccLineEnd && (
        <line clipPath="url(#pm-clip2)"
          x1={toX(0)} y1={toY(0)}
          x2={toX(eccLineEnd.M)} y2={toY(eccLineEnd.P)}
          stroke="#cc2222" strokeWidth="1" strokeDasharray="5 3"/>
      )}

      {/* ── 공칭 곡선 (파랑 실선) ── */}
      <path d={nomPath} fill="none"
        stroke="#2255cc" strokeWidth="1.8" strokeLinejoin="round"
        clipPath="url(#pm-clip2)"/>

      {/* ── 설계 곡선 (빨강 실선) ── */}
      <path d={desPath} fill="none"
        stroke="#cc2222" strokeWidth="1.5" strokeLinejoin="round"
        clipPath="url(#pm-clip2)"/>

      {/* ── 균형파괴점 (설계) ── */}
      <circle cx={toX(balPt.M)} cy={toY(balPt.P)} r="3"
        fill="#cc2222" stroke="#fff" strokeWidth="1"
        clipPath="url(#pm-clip2)"/>
      {/* eb 레이블 */}
      {balPt.M > 0 && balPt.P > 0 && (
        <text x={toX(balPt.M) + 5} y={toY(balPt.P) - 3}
          fontSize="8" fontFamily="var(--font-mono)" fill="#cc2222" fontWeight="600">
          eb={(balPt.M / balPt.P * 1000).toFixed(0)}mm
        </text>
      )}

      {/* ── 설계곡선 교점 (φPn, φMn) ── */}
      {capPt && (
        <>
          {/* 교점 마커 */}
          <circle cx={toX(capPt.M)} cy={toY(capPt.P)} r="3.5"
            fill="#2255cc" stroke="#fff" strokeWidth="1"
            clipPath="url(#pm-clip2)"/>
          {/* 교점 좌표 레이블 */}
          <text x={toX(capPt.M) + 6} y={toY(capPt.P) - 6}
            fontSize="7.5" fontFamily="var(--font-mono)" fill="#2255cc" fontWeight="700">
            ({Math.round(capPt.P)}, {Math.round(capPt.M)})
          </text>
          {/* 교점→하중점 수직 보조선 */}
          <line clipPath="url(#pm-clip2)"
            x1={toX(capPt.M)} y1={toY(capPt.P)}
            x2={toX(Mu)} y2={toY(Pu)}
            stroke="#888" strokeWidth="0.6" strokeDasharray="3 2"/>
        </>
      )}

      {/* ── 하중점 (빨간 십자 마커) ── */}
      {(() => {
        const cx = toX(Mu), cy = toY(Pu)
        const arm = 6
        return (
          <g clipPath="url(#pm-clip2)">
            <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy}
              stroke="#cc2222" strokeWidth="1.5"/>
            <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm}
              stroke="#cc2222" strokeWidth="1.5"/>
            {/* 하중점 좌표 */}
            <text x={cx + 8} y={cy + 4}
              fontSize="7.5" fontFamily="var(--font-mono)" fill="#cc2222" fontWeight="700">
              ({Math.round(Pu)}, {Math.round(Mu)})
            </text>
          </g>
        )
      })()}

      {/* ── θ 각도 표시 (원점에서 편심선 각도) ── */}
      {Mu > 0 && Pu > 0 && (
        <text x={toX(mMax * 0.12)} y={toY(Pu / Mu * mMax * 0.12) - 5}
          fontSize="7.5" fontFamily="var(--font-mono)" fill="#cc2222">
          θ={(Math.atan(Pu / Mu) * 180 / Math.PI).toFixed(1)}°
        </text>
      )}

      {/* ── φPn,max 수평선 ── */}
      <line clipPath="url(#pm-clip2)"
        x1={padL} y1={toY(phiPn_max)} x2={padL + W} y2={toY(phiPn_max)}
        stroke="#2255cc" strokeWidth="0.7" strokeDasharray="4 3" opacity="0.6"/>
      <text x={padL + 3} y={toY(phiPn_max) - 2}
        fontSize="7" fontFamily="var(--font-mono)" fill="#2255cc" opacity="0.8">
        φPn,max={Math.round(phiPn_max)}
      </text>

      {/* ── 테두리 ── */}
      <rect x={padL} y={padT} width={W} height={H}
        fill="none" stroke="#8898b0" strokeWidth="1"/>

      {/* ── Y축 눈금 ── */}
      {pTicks.map(v => {
        const y = toY(v); if (y < padT - 1 || y > padT + H + 1) return null
        return (
          <g key={`pt-${v}`}>
            <line x1={padL - 4} y1={y} x2={padL} y2={y} stroke="#5a6480" strokeWidth="0.8"/>
            <text x={padL - 6} y={y + 3.5} textAnchor="end"
              fontSize="7.5" fontFamily="var(--font-mono)"
              fontWeight={v === 0 ? 700 : 400} fill={v === 0 ? '#1a1f2e' : '#5a6480'}>
              {fmt(v)}
            </text>
          </g>
        )
      })}

      {/* ── X축 눈금 ── */}
      {mTicks.map(v => {
        const x = toX(v)
        return (
          <g key={`mt-${v}`}>
            <line x1={x} y1={padT + H} x2={x} y2={padT + H + 3} stroke="#5a6480" strokeWidth="0.8"/>
            <text x={x} y={padT + H + 12} textAnchor="middle"
              fontSize="7" fontFamily="var(--font-mono)" fill="#5a6480">
              {fmt(v)}
            </text>
          </g>
        )
      })}

      {/* ── 축 제목 ── */}
      <text x={padL - 40} y={padT + H / 2} textAnchor="middle"
        fontSize="8.5" fontFamily="var(--font-mono)" fontWeight="700" fill="#3a4155"
        transform={`rotate(-90,${padL - 40},${padT + H / 2})`}>
        P (kN)
      </text>
      <text x={padL + W / 2} y={VH - 2} textAnchor="middle"
        fontSize="8.5" fontFamily="var(--font-mono)" fontWeight="700" fill="#3a4155">
        M (kN·m)
      </text>

      {/* ── 범례 ── */}
      <g transform={`translate(${padL + W - 110},${padT + 4})`}>
        <rect x="0" y="0" width="108" height="38"
          fill="white" fillOpacity="0.92" stroke="#c8cdd6" strokeWidth="0.7" rx="1"/>
        <line x1="5" y1="10" x2="20" y2="10" stroke="#2255cc" strokeWidth="1.8"/>
        <text x="24" y="13" fontSize="7.5" fontFamily="var(--font-mono)" fontWeight="600" fill="#2255cc">Nominal (Pn-Mn)</text>
        <line x1="5" y1="24" x2="20" y2="24" stroke="#cc2222" strokeWidth="1.5"/>
        <text x="24" y="27" fontSize="7.5" fontFamily="var(--font-mono)" fontWeight="600" fill="#cc2222">Design (φPn-φMn)</text>
      </g>

      {/* ── 하단 정보 박스 ── */}
      <g transform={`translate(${padL},${padT + H + 14})`}>
        {/* ρ */}
        <text x="0" y="10" fontSize="8" fontFamily="var(--font-mono)" fill="#3a4155">
          ρ = {rho_g.toFixed(4)}
        </text>
        {capPt && (
          <>
            <text x={W * 0.22} y="10" fontSize="8" fontFamily="var(--font-mono)" fill="#2255cc">
              φPn = {Math.round(capPt.P)} kN
            </text>
            <text x={W * 0.5} y="10" fontSize="8" fontFamily="var(--font-mono)" fill="#cc2222">
              Pu = {Math.round(Pu)} kN
            </text>
            <text x={W * 0.22} y="20" fontSize="8" fontFamily="var(--font-mono)" fill="#2255cc">
              φMn = {Math.round(capPt.M)} kN·m
            </text>
            <text x={W * 0.5} y="20" fontSize="8" fontFamily="var(--font-mono)" fill="#cc2222">
              Mu = {Math.round(Mu)} kN·m
            </text>
            {SF !== null && (
              <text x={W * 0.76} y="15" fontSize="9" fontFamily="var(--font-mono)"
                fontWeight="700" fill={inside ? '#1a7a3c' : '#c41a1a'}>
                F.S = {isFinite(SF) ? SF.toFixed(2) : '∞'}  {inside ? 'O.K' : 'N.G'}
              </text>
            )}
          </>
        )}
      </g>
    </svg>
  )
}

// ── 공용 스타일 ─────────────────────────────────────────────
const S = {
  row: {
    display: 'grid' as const,
    gridTemplateColumns: '7.5rem 1fr',
    alignItems: 'center',
    gap: '0',
    borderBottom: '1px solid var(--border-light)',
    minHeight: '1.85rem',
  },
  label: {
    fontSize: '0.72rem' as const,
    fontWeight: 600,
    color: 'var(--text-2)',
    padding: '0.2rem 0.5rem',
    borderRight: '1px solid var(--border-light)',
    background: 'var(--surface-2)',
    height: '100%',
    display: 'flex' as const,
    alignItems: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  inputWrap: {
    padding: '0.18rem 0.3rem',
  },
}

// 테이블형 입력 행
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.row}>
      <div style={S.label}>{label}</div>
      <div style={S.inputWrap}>{children}</div>
    </div>
  )
}

function NumInput({ value, min, step = 1, onChange }: {
  value: number; min?: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <input type="number" value={value} min={min} step={step}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%' }}
    />
  )
}

function SelInput({ value, options, onChange }: {
  value: number | string
  options: { v: number | string; label: string }[]
  onChange: (v: number | string) => void
}) {
  return (
    <select value={value} onChange={e => {
      const raw = e.target.value
      const num = Number(raw)
      onChange(isNaN(num) ? raw : num)
    }} style={{ width: '100%' }}>
      {options.map(o => <option key={String(o.v)} value={o.v}>{o.label}</option>)}
    </select>
  )
}

// ── 툴팁: lu 비지지길이 ──────────────────────────────────────
function LuTooltip() {
  return (
    <div style={{ width: 300 }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 800,
        color: 'var(--primary)',
        fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
        marginBottom: '0.35rem',
        letterSpacing: '0.01em',
      }}>비지지길이 l<sub>u</sub></div>
      <div style={{
        fontSize: '0.67rem', color: '#e8effe',
        fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
        lineHeight: 1.6, marginBottom: '0.5rem',
      }}>
        기둥의 <b>횡방향 지지점(보, 슬래브) 사이의 순간격</b>.<br/>
        층고에서 상·하 보 깊이를 뺀 값을 사용한다.<br/>
        <span style={{ color: '#c7d9fb', fontSize: '0.63rem' }}>
          KDS 14 20 20 : 9.6절
        </span>
      </div>
      {/* SVG 다이어그램 */}
      <svg viewBox="0 0 280 200" width="100%" style={{ display: 'block', background: '#1a2540', borderRadius: 4 }}>
        {/* 상단 슬래브 */}
        <rect x="20" y="10" width="240" height="22" fill="#3a5080" rx="2"/>
        <text x="140" y="25" textAnchor="middle" fill="#c7d9fb" fontSize="10" fontFamily="JetBrains Mono,monospace">슬래브 / 보 (상단 지지점)</text>
        {/* 기둥 */}
        <rect x="105" y="32" width="70" height="136" fill="#2a3f6a" stroke="#4a6fa0" strokeWidth="1.5"/>
        {/* 철근 표시 */}
        <line x1="115" y1="38" x2="115" y2="162" stroke="#e8c060" strokeWidth="2"/>
        <line x1="165" y1="38" x2="165" y2="162" stroke="#e8c060" strokeWidth="2"/>
        <line x1="120" y1="38" x2="120" y2="162" stroke="#e8c060" strokeWidth="1.5"/>
        <line x1="160" y1="38" x2="160" y2="162" stroke="#e8c060" strokeWidth="1.5"/>
        {/* 하단 슬래브 */}
        <rect x="20" y="168" width="240" height="22" fill="#3a5080" rx="2"/>
        <text x="140" y="183" textAnchor="middle" fill="#c7d9fb" fontSize="10" fontFamily="JetBrains Mono,monospace">슬래브 / 보 (하단 지지점)</text>
        {/* lu 치수선 */}
        <line x1="88" y1="32" x2="88" y2="168" stroke="#ff9f43" strokeWidth="1.5" strokeDasharray="4,2"/>
        <line x1="84" y1="32" x2="92" y2="32" stroke="#ff9f43" strokeWidth="1.5"/>
        <line x1="84" y1="168" x2="92" y2="168" stroke="#ff9f43" strokeWidth="1.5"/>
        <text x="78" y="104" textAnchor="middle" fill="#ff9f43" fontSize="12" fontFamily="JetBrains Mono,monospace" fontWeight="700">l</text>
        <text x="84" y="108" textAnchor="middle" fill="#ff9f43" fontSize="9" fontFamily="JetBrains Mono,monospace">u</text>
      </svg>
    </div>
  )
}

// ── 툴팁: K 유효길이계수 ──────────────────────────────────────
function KTooltip() {
  return (
    <div style={{ width: 340 }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 800,
        color: 'var(--primary)',
        fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
        marginBottom: '0.35rem',
      }}>유효길이계수 K</div>
      <div style={{
        fontSize: '0.67rem', color: '#e8effe',
        fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
        lineHeight: 1.6, marginBottom: '0.5rem',
      }}>
        기둥의 <b>단부 구속조건</b>에 따라 결정되는 계수.<br/>
        유효좌굴길이 = K · l<sub>u</sub><br/>
        <span style={{ color: '#c7d9fb', fontSize: '0.63rem' }}>
          KDS 14 20 20 : 9.6절  (비횡이동 골조 기준)
        </span>
      </div>
      {/* SVG: K값별 좌굴형상 5가지 */}
      <svg viewBox="0 0 320 170" width="100%" style={{ display: 'block', background: '#1a2540', borderRadius: 4 }}>
        {/* 공통 설정 */}
        {/* Case 1: 양단 핀 K=1.0 */}
        <g transform="translate(10,10)">
          <rect x="18" y="0" width="28" height="8" fill="#3a5080" rx="1"/>
          <rect x="18" y="142" width="28" height="8" fill="#3a5080" rx="1"/>
          {/* 핀 기호 상단 */}
          <polygon points="32,8 26,18 38,18" fill="none" stroke="#7a9fcc" strokeWidth="1.2"/>
          {/* 핀 기호 하단 */}
          <polygon points="32,142 26,132 38,132" fill="none" stroke="#7a9fcc" strokeWidth="1.2"/>
          {/* 좌굴형상 (사인곡선) */}
          <path d="M32,18 Q52,80 32,132" fill="none" stroke="#ff9f43" strokeWidth="2" strokeDasharray="3,2"/>
          <line x1="32" y1="18" x2="32" y2="132" stroke="#4a6fa0" strokeWidth="1.5"/>
          <text x="32" y="160" textAnchor="middle" fill="#ff9f43" fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">K=1.0</text>
          <text x="32" y="172" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">양단핀</text>
        </g>
        {/* Case 2: 양단 고정 K=0.5 */}
        <g transform="translate(70,10)">
          <rect x="18" y="0" width="28" height="8" fill="#3a5080" rx="1"/>
          <rect x="18" y="142" width="28" height="8" fill="#3a5080" rx="1"/>
          {/* 고정 기호 (빗금) */}
          {[0,5,10,15,20].map(i => (
            <line key={i} x1={18+i} y1="0" x2={13+i} y2="-6" stroke="#7a9fcc" strokeWidth="1"/>
          ))}
          {[0,5,10,15,20].map(i => (
            <line key={i} x1={18+i} y1="150" x2={13+i} y2="156" stroke="#7a9fcc" strokeWidth="1"/>
          ))}
          {/* S자 좌굴형상 */}
          <path d="M32,8 Q52,45 32,75 Q12,105 32,142" fill="none" stroke="#ff9f43" strokeWidth="2" strokeDasharray="3,2"/>
          <line x1="32" y1="8" x2="32" y2="142" stroke="#4a6fa0" strokeWidth="1.5"/>
          {/* K=0.5 표시선 */}
          <line x1="10" y1="38" x2="28" y2="38" stroke="#54d98c" strokeWidth="1" strokeDasharray="2,2"/>
          <line x1="10" y1="112" x2="28" y2="112" stroke="#54d98c" strokeWidth="1" strokeDasharray="2,2"/>
          <text x="32" y="160" textAnchor="middle" fill="#ff9f43" fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">K=0.5</text>
          <text x="32" y="172" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">양단고정</text>
        </g>
        {/* Case 3: 하단고정 상단핀 K=0.7 */}
        <g transform="translate(130,10)">
          <rect x="18" y="142" width="28" height="8" fill="#3a5080" rx="1"/>
          {[0,5,10,15,20].map(i => (
            <line key={i} x1={18+i} y1="150" x2={13+i} y2="156" stroke="#7a9fcc" strokeWidth="1"/>
          ))}
          <polygon points="32,8 26,18 38,18" fill="none" stroke="#7a9fcc" strokeWidth="1.2"/>
          <path d="M32,18 Q50,90 32,142" fill="none" stroke="#ff9f43" strokeWidth="2" strokeDasharray="3,2"/>
          <line x1="32" y1="18" x2="32" y2="142" stroke="#4a6fa0" strokeWidth="1.5"/>
          <text x="32" y="160" textAnchor="middle" fill="#ff9f43" fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">K=0.7</text>
          <text x="32" y="172" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">하단고정</text>
          <text x="32" y="180" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">상단핀</text>
        </g>
        {/* Case 4: 하단고정 상단자유 K=2.0 */}
        <g transform="translate(195,10)">
          <rect x="18" y="142" width="28" height="8" fill="#3a5080" rx="1"/>
          {[0,5,10,15,20].map(i => (
            <line key={i} x1={18+i} y1="150" x2={13+i} y2="156" stroke="#7a9fcc" strokeWidth="1"/>
          ))}
          {/* 자유단 표시 */}
          <line x1="22" y1="8" x2="42" y2="8" stroke="#7a9fcc" strokeWidth="1.5"/>
          <path d="M32,8 Q52,75 32,142" fill="none" stroke="#ff9f43" strokeWidth="2" strokeDasharray="3,2"/>
          <line x1="32" y1="8" x2="32" y2="142" stroke="#4a6fa0" strokeWidth="1.5"/>
          <text x="32" y="160" textAnchor="middle" fill="#ff9f43" fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">K=2.0</text>
          <text x="32" y="172" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">하단고정</text>
          <text x="32" y="180" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">상단자유</text>
        </g>
        {/* Case 5: 양단고정 횡이동 K=1.2 */}
        <g transform="translate(258,10)">
          <rect x="18" y="0" width="28" height="8" fill="#3a5080" rx="1"/>
          <rect x="18" y="142" width="28" height="8" fill="#3a5080" rx="1"/>
          {[0,5,10,15,20].map(i => (
            <line key={i} x1={18+i} y1="0" x2={13+i} y2="-6" stroke="#7a9fcc" strokeWidth="1"/>
          ))}
          {[0,5,10,15,20].map(i => (
            <line key={i} x1={18+i} y1="150" x2={13+i} y2="156" stroke="#7a9fcc" strokeWidth="1"/>
          ))}
          {/* 횡이동 곡선 */}
          <path d="M32,8 Q52,75 42,142" fill="none" stroke="#ff9f43" strokeWidth="2" strokeDasharray="3,2"/>
          <line x1="32" y1="8" x2="42" y2="142" stroke="#4a6fa0" strokeWidth="1.5"/>
          <text x="37" y="160" textAnchor="middle" fill="#ff9f43" fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">K=1.2</text>
          <text x="37" y="172" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">횡이동</text>
          <text x="37" y="180" textAnchor="middle" fill="#8899bb" fontSize="8" fontFamily="JetBrains Mono,monospace">골조</text>
        </g>
      </svg>
      {/* 권고값 표 */}
      <div style={{
        marginTop: '0.4rem',
        fontSize: '0.63rem',
        fontFamily: 'JetBrains Mono, monospace',
        color: '#c7d9fb',
        lineHeight: 1.7,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <span>비횡이동 골조</span><span style={{ color: '#ff9f43' }}>K ≤ 1.0 (권고: 0.65~1.0)</span>
          <span>횡이동 골조</span><span style={{ color: '#ff9f43' }}>K ≥ 1.0 (권고: 1.2~2.0)</span>
          <span>보수적 기본값</span><span style={{ color: '#54d98c' }}>K = 1.0</span>
        </div>
      </div>
    </div>
  )
}

// ── RowWithTooltip: 라벨에 ? 아이콘 + hover 툴팁 ────────────
function RowWithTooltip({ label, tooltip, children }: {
  label: string
  tooltip: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen(true)
  }
  const hide = () => {
    timerRef.current = setTimeout(() => setOpen(false), 120)
  }

  // 툴팁 위치: 패널 우측으로 나올 수 있게 fixed positioning
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.top, left: r.right + 8 })
    }
    show()
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <div ref={wrapRef} style={S.row}>
      <div style={{ ...S.label, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <span>{label}</span>
        <button
          ref={triggerRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={hide}
          onFocus={handleMouseEnter}
          onBlur={hide}
          style={{
            border: '1px solid var(--border-dark)',
            borderRadius: '50%',
            width: '0.95rem', height: '0.95rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.55rem', fontWeight: 800,
            cursor: 'help',
            background: 'var(--primary-bg)',
            color: 'var(--primary)',
            padding: 0, lineHeight: 1,
            flexShrink: 0,
          }}
          tabIndex={0}
          aria-label={`${label} 설명`}
        >?</button>
      </div>
      <div style={S.inputWrap}>{children}</div>
      {/* 툴팁 팝업 (fixed, 패널 우측) */}
      {open && (
        <div
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: 'fixed',
            top: Math.min(pos.top, window.innerHeight - 420),
            left: pos.left,
            zIndex: 9999,
            background: '#1e2d4a',
            border: '1px solid #3a5080',
            borderRadius: '6px',
            padding: '0.7rem 0.8rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            maxWidth: 380,
            pointerEvents: 'auto',
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  )
}

// 섹션 헤더 (트리 그룹 제목)
function GroupHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.3rem 0.6rem',
      background: 'var(--surface-3)',
      borderBottom: '1px solid var(--border-dark)',
      borderTop: '1px solid var(--border-dark)',
      marginTop: '0.15rem',
    }}>
      <span style={{
        fontSize: '0.72rem', fontWeight: 700,
        color: 'var(--text-2)',
        letterSpacing: '0.04em',
      }}>{title}</span>
      {sub && <span style={{
        fontSize: '0.62rem', color: 'var(--text-disabled)',
        fontFamily: 'var(--font-mono)',
      }}>{sub}</span>}
    </div>
  )
}

// 결과 요약 배지
function StatusBadge({ status }: { status: 'OK' | 'NG' | 'WARN' }) {
  const map = {
    OK:   { label: 'O.K',  bg: 'var(--success)', },
    NG:   { label: 'N.G',  bg: 'var(--danger)',  },
    WARN: { label: 'WARN', bg: 'var(--warning)', },
  }
  const { label, bg } = map[status]
  return (
    <span style={{
      background: bg, color: '#fff',
      fontSize: '0.72rem', fontWeight: 800,
      fontFamily: 'var(--font-mono)',
      padding: '0.12rem 0.55rem',
      borderRadius: '2px',
      letterSpacing: '0.06em',
    }}>{label}</span>
  )
}

// ── 토글 버튼 그룹 (shape / transverse type 선택용) ──
function ToggleButtons<T extends string>({ value, options, onChange }: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{
      display: 'flex', gap: '0', margin: '0.2rem 0.4rem',
      border: '1px solid var(--border-dark)', borderRadius: '2px', overflow: 'hidden',
    }}>
      {options.map(({ v, label }) => (
        <button key={v}
          onClick={() => onChange(v)}
          style={{
            flex: 1, border: 'none', padding: '0.22rem 0',
            fontSize: '0.63rem', fontWeight: 700,
            fontFamily: 'var(--font-mono)', cursor: 'pointer',
            background: value === v ? 'var(--primary)' : 'var(--surface-2)',
            color: value === v ? '#fff' : 'var(--text-3)',
            letterSpacing: '0.01em',
          }}>{label}</button>
      ))}
    </div>
  )
}

// ── SVG 기둥 단면도 ─────────────────────────────────────────
function ColumnDiagram({ sec, reb, tie, width = 310, height = 370 }: {
  sec: ColumnSectionInput
  reb: ColumnRebarInput
  tie: ColumnTieInput
  width?: number
  height?: number
}) {
  const { shape, b, h, D, cover, coverMode, steelShape } = sec
  const { dia: barDia } = reb
  const nBar = totalRebarCount(shape, reb)
  const { transverseType, dia: tieDia, spiralDia, spiralPitch } = tie

  const transverseDia = transverseType === 'tie' ? tieDia : spiralDia

  // ── Rectangular / Composite diagram ──
  if (shape === 'rectangular' || shape === 'composite') {
    if (b <= 0 || h <= 0) return null

    const pad = 40
    const drawW = width - 2 * pad
    const drawH = height - 2 * pad - 30
    const scale = Math.min(drawW / b, drawH / h)
    const cw = b * scale
    const ch = h * scale
    const ox = (width - cw) / 2
    const oy = (height - ch) / 2 - 10

    // 피복/타이 오프셋
    const coverDist = coverMode === 'center'
      ? cover - transverseDia - barDia / 2
      : cover
    const tieOffset = coverDist * scale
    const barCenter = coverMode === 'center'
      ? cover * scale
      : (cover + transverseDia + barDia / 2) * scale

    // 철근 위치 계산 — 헬퍼 사용
    const barR = Math.max(barDia * scale / 2, 3)
    const bars = rectRebarPositions(reb, ox, oy, cw, ch, barCenter)

    const Ast = nBar * (REBAR_AREA[barDia] ?? 0)

    // Composite: parse H-shape dimensions for SVG
    let steelSvg: React.ReactNode = null
    if (shape === 'composite') {
      // Try to parse steelShape like 'H-200x200x8x12' or 'H-200×200×8×12'
      const parts = steelShape.replace(/H-/i, '').split(/[x\u00d7]/)
      let sH = 200, sB = 200, tw = 8, tf = 12
      if (parts.length >= 4) {
        sH = Number(parts[0]) || 200
        sB = Number(parts[1]) || 200
        tw = Number(parts[2]) || 8
        tf = Number(parts[3]) || 12
      }
      // Scale steel dimensions
      const shS = sH * scale
      const sbS = sB * scale
      const twS = Math.max(tw * scale, 1.5)
      const tfS = Math.max(tf * scale, 1.5)
      const cx = ox + cw / 2
      const cy = oy + ch / 2

      steelSvg = (
        <g>
          {/* Top flange */}
          <rect x={cx - sbS / 2} y={cy - shS / 2} width={sbS} height={tfS}
            fill="var(--primary)" fillOpacity="0.25" stroke="var(--primary)" strokeWidth="1.2"/>
          {/* Bottom flange */}
          <rect x={cx - sbS / 2} y={cy + shS / 2 - tfS} width={sbS} height={tfS}
            fill="var(--primary)" fillOpacity="0.25" stroke="var(--primary)" strokeWidth="1.2"/>
          {/* Web */}
          <rect x={cx - twS / 2} y={cy - shS / 2 + tfS} width={twS} height={shS - 2 * tfS}
            fill="var(--primary)" fillOpacity="0.15" stroke="var(--primary)" strokeWidth="1"/>
        </g>
      )
    }

    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
        style={{ maxWidth: width, maxHeight: height }}>
        <defs>
          <pattern id="col-hatch" width="6" height="6" patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-disabled)" strokeWidth="0.5" opacity="0.3"/>
          </pattern>
        </defs>

        {/* 콘크리트 단면 */}
        <rect x={ox} y={oy} width={cw} height={ch}
          fill="url(#col-hatch)" stroke="var(--text)" strokeWidth="1.5"/>

        {/* 타이 외곽선 (dashed) */}
        <rect
          x={ox + tieOffset} y={oy + tieOffset}
          width={cw - 2 * tieOffset} height={ch - 2 * tieOffset}
          fill="none" stroke="var(--primary)" strokeWidth="1" strokeDasharray="4 3"
        />

        {/* Composite: H-shape steel */}
        {steelSvg}

        {/* 철근 */}
        {bars.map((bar, i) => (
          <circle key={i} cx={bar.cx} cy={bar.cy} r={barR}
            fill="var(--text)" stroke="#fff" strokeWidth="0.5"/>
        ))}

        {/* 치수선 — b (하단) */}
        <line x1={ox} y1={oy + ch + 15} x2={ox + cw} y2={oy + ch + 15}
          stroke="var(--text-3)" strokeWidth="0.7" markerStart="url(#arrow)" markerEnd="url(#arrow)"/>
        <line x1={ox} y1={oy + ch + 5} x2={ox} y2={oy + ch + 20}
          stroke="var(--text-3)" strokeWidth="0.5"/>
        <line x1={ox + cw} y1={oy + ch + 5} x2={ox + cw} y2={oy + ch + 20}
          stroke="var(--text-3)" strokeWidth="0.5"/>
        <text x={ox + cw / 2} y={oy + ch + 27}
          textAnchor="middle" fontSize="10" fill="var(--text-2)"
          fontFamily="var(--font-mono)" fontWeight="600">
          b = {b}
        </text>

        {/* 치수선 — h (우측) */}
        <line x1={ox + cw + 15} y1={oy} x2={ox + cw + 15} y2={oy + ch}
          stroke="var(--text-3)" strokeWidth="0.7"/>
        <line x1={ox + cw + 5} y1={oy} x2={ox + cw + 20} y2={oy}
          stroke="var(--text-3)" strokeWidth="0.5"/>
        <line x1={ox + cw + 5} y1={oy + ch} x2={ox + cw + 20} y2={oy + ch}
          stroke="var(--text-3)" strokeWidth="0.5"/>
        <text x={ox + cw + 27} y={oy + ch / 2}
          textAnchor="middle" fontSize="10" fill="var(--text-2)"
          fontFamily="var(--font-mono)" fontWeight="600"
          transform={`rotate(90, ${ox + cw + 27}, ${oy + ch / 2})`}>
          h = {h}
        </text>

        {/* 철근 레이블 */}
        <text x={width / 2} y={height - 5}
          textAnchor="middle" fontSize="9" fill="var(--text-3)"
          fontFamily="var(--font-mono)">
          {nBar}-D{barDia}  Ast = {Math.round(Ast)} mm²
          {shape === 'composite' ? `  [${steelShape}]` : ''}
        </text>
      </svg>
    )
  }

  // ── Circular diagram ──
  if (D <= 0) return null

  const pad = 40
  const drawSize = Math.min(width, height) - 2 * pad - 30
  const scale = drawSize / D
  const cD = D * scale
  const cx = width / 2
  const cy = (height - 30) / 2

  const coverDist = coverMode === 'center'
    ? cover - transverseDia - barDia / 2
    : cover
  const tieOffsetR = coverDist * scale
  const barCenterR = coverMode === 'center'
    ? cover * scale
    : (cover + transverseDia + barDia / 2) * scale
  const barR = Math.max(barDia * scale / 2, 3)
  const barCircleR = cD / 2 - barCenterR

  // Bars arranged in circle
  const bars: { bx: number; by: number }[] = []
  for (let i = 0; i < nBar; i++) {
    const angle = (2 * Math.PI * i) / nBar - Math.PI / 2
    bars.push({
      bx: cx + barCircleR * Math.cos(angle),
      by: cy + barCircleR * Math.sin(angle),
    })
  }

  // Core diameter for spiral
  const DcPx = cD - 2 * coverDist * scale
  const Ast = nBar * (REBAR_AREA[barDia] ?? 0)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
      style={{ maxWidth: width, maxHeight: height }}>
      <defs>
        <pattern id="col-hatch-circ" width="6" height="6" patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-disabled)" strokeWidth="0.5" opacity="0.3"/>
        </pattern>
      </defs>

      {/* 콘크리트 단면 (원) */}
      <circle cx={cx} cy={cy} r={cD / 2}
        fill="url(#col-hatch-circ)" stroke="var(--text)" strokeWidth="1.5"/>

      {/* Core (Dc) dashed circle */}
      <circle cx={cx} cy={cy} r={DcPx / 2}
        fill="none" stroke="var(--text-3)" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.5"/>

      {/* Spiral / tie dashed circle */}
      <circle cx={cx} cy={cy} r={cD / 2 - tieOffsetR}
        fill="none" stroke="var(--primary)" strokeWidth="1"
        strokeDasharray={transverseType === 'spiral' ? '2 2' : '4 3'}/>

      {/* 철근 */}
      {bars.map((bar, i) => (
        <circle key={i} cx={bar.bx} cy={bar.by} r={barR}
          fill="var(--text)" stroke="#fff" strokeWidth="0.5"/>
      ))}

      {/* 치수선 — D (하단) */}
      <line x1={cx - cD / 2} y1={cy + cD / 2 + 15} x2={cx + cD / 2} y2={cy + cD / 2 + 15}
        stroke="var(--text-3)" strokeWidth="0.7"/>
      <line x1={cx - cD / 2} y1={cy + cD / 2 + 5} x2={cx - cD / 2} y2={cy + cD / 2 + 20}
        stroke="var(--text-3)" strokeWidth="0.5"/>
      <line x1={cx + cD / 2} y1={cy + cD / 2 + 5} x2={cx + cD / 2} y2={cy + cD / 2 + 20}
        stroke="var(--text-3)" strokeWidth="0.5"/>
      <text x={cx} y={cy + cD / 2 + 27}
        textAnchor="middle" fontSize="10" fill="var(--text-2)"
        fontFamily="var(--font-mono)" fontWeight="600">
        D = {D}
      </text>

      {/* 나선 레이블 */}
      {transverseType === 'spiral' && (
        <text x={cx} y={cy - cD / 2 - 8}
          textAnchor="middle" fontSize="8" fill="var(--primary)"
          fontFamily="var(--font-mono)" fontWeight="600">
          spiral D{spiralDia}@{spiralPitch}
        </text>
      )}

      {/* 철근 레이블 */}
      <text x={width / 2} y={height - 5}
        textAnchor="middle" fontSize="9" fill="var(--text-3)"
        fontFamily="var(--font-mono)">
        {nBar}-D{barDia}  Ast = {Math.round(Ast)} mm²
      </text>
    </svg>
  )
}

// ── 메인 패널 ───────────────────────────────────────────────
export default function ColumnPanel() {
  const { isCompact } = useResponsive()
  const [mat, setMat] = useState<MaterialInput>(DEFAULT_MAT)
  const [sec, setSec] = useState<ColumnSectionInput>(DEFAULT_SEC)
  const [reb, setReb] = useState<ColumnRebarInput>(DEFAULT_REB)
  const [tie, setTie] = useState<ColumnTieInput>(DEFAULT_TIE)
  const [loads, setLoads] = useState<ColumnLoadInput[]>(DEFAULT_LOADS)
  const [activeLoadIdx, setActiveLoadIdx] = useState(0)
  const [activeTab, setActiveTab] = useState<'input' | 'section' | 'result'>('input')
  const [activeResultIdx, setActiveResultIdx] = useState(0)  // 결과 패널에서 선택된 조합

  const load = loads[activeLoadIdx] ?? loads[0]

  // 모든 조합 계산
  const allResults = loads.map(l => calcColumn(mat, sec, reb, tie, l))

  // 결과 패널에서 선택된 조합 결과
  const result = allResults[activeResultIdx] ?? allResults[0]

  // rho_g (단면 기반, 조합 무관)
  const _Ag = sec.shape === 'circular'
    ? Math.PI / 4 * sec.D * sec.D
    : sec.b * sec.h
  const _nBar = totalRebarCount(sec.shape, reb)
  const _Ast = _nBar * (REBAR_AREA[reb.dia] ?? 0)
  const rho_g = _Ag > 0 ? _Ast / _Ag : 0

  // 전체 worst-case 판정
  const worstStatus: 'OK' | 'NG' | 'WARN' = allResults.some(r => r.overallStatus === 'NG')
    ? 'NG'
    : allResults.some(r => r.overallStatus === 'WARN')
    ? 'WARN'
    : 'OK'

  // 하중 조합 추가
  const addLoad = () => {
    const n = loads.length + 1
    const newLoad: ColumnLoadInput = { ...DEFAULT_LOAD, name: `LC${n}` }
    setLoads(prev => [...prev, newLoad])
    setActiveLoadIdx(loads.length)
  }

  // 하중 조합 삭제
  const removeLoad = (idx: number) => {
    if (loads.length <= 1) return
    setLoads(prev => prev.filter((_, i) => i !== idx))
    setActiveLoadIdx(prev => Math.min(prev, loads.length - 2))
    setActiveResultIdx(prev => Math.min(prev, loads.length - 2))
  }

  // 현재 조합 업데이트
  const updateLoad = (updater: (l: ColumnLoadInput) => ColumnLoadInput) => {
    setLoads(prev => prev.map((l, i) => i === activeLoadIdx ? updater(l) : l))
  }

  const nBar = totalRebarCount(sec.shape, reb)
  const Ast = nBar * (REBAR_AREA[reb.dia] ?? 0)
  const transverseDia = tie.transverseType === 'tie' ? tie.dia : tie.spiralDia

  // Shape-dependent computed values for display
  let Ag: number
  let d_prime: number
  let d: number

  if (sec.shape === 'circular') {
    Ag = Math.PI / 4 * sec.D * sec.D
    d_prime = sec.coverMode === 'center'
      ? sec.cover
      : sec.cover + transverseDia + reb.dia / 2
    d = sec.D - d_prime
  } else {
    Ag = sec.b * sec.h
    d_prime = sec.coverMode === 'center'
      ? sec.cover
      : sec.cover + transverseDia + reb.dia / 2
    d = sec.h - d_prime
  }

  const rebarOptions = [16, 19, 22, 25, 29, 32, 35].map(d => ({
    v: d, label: `D${d}  (${REBAR_AREA[d]} mm²)`
  }))
  const tieOptions = [10, 13, 16].map(d => ({ v: d, label: `D${d}` }))

  // ── 모바일/태블릿: 탭 전환 바 ──
  const TabBar = () => (
    <div style={{
      display: 'flex', borderBottom: '2px solid var(--border-dark)',
      background: 'var(--surface-3)', flexShrink: 0,
    }}>
      {([['input', '입력'], ['section', '단면도'], ['result', '결과']] as const).map(([id, label]) => (
        <button key={id}
          onClick={() => setActiveTab(id)}
          style={{
            flex: 1, border: 'none', padding: '0.45rem 0',
            fontSize: '0.75rem', fontWeight: 700,
            fontFamily: 'var(--font-mono)', cursor: 'pointer',
            background: activeTab === id ? 'var(--primary)' : 'transparent',
            color: activeTab === id ? '#fff' : 'var(--text-3)',
            borderBottom: activeTab === id ? '2px solid var(--primary)' : '2px solid transparent',
          }}>
          {label}
        </button>
      ))}
    </div>
  )

  // ── 패널 표시 여부 (데스크탑=항상, 모바일/태블릿=탭) ──
  const showInput = !isCompact || activeTab === 'input'
  const showSection = !isCompact || activeTab === 'section'
  const showResult = !isCompact || activeTab === 'result'

  // ── 단면 유효 여부 (SVG 표시 조건) ──
  const sectionValid = sec.shape === 'circular'
    ? sec.D > 0
    : sec.b > 0 && sec.h > 0

  // ── Section Summary items ──
  const summaryItems: [string, string][] = sec.shape === 'circular'
    ? [
      ['D', `${sec.D} mm`],
      ['d', `${d > 0 ? d.toFixed(0) : '\u2014'} mm`],
      ['Ast', `${Math.round(Ast)} mm\u00b2`],
      ['\u03c1g', `${Ag > 0 ? (Ast / Ag * 100).toFixed(2) : '\u2014'}%`],
    ]
    : sec.shape === 'composite'
    ? [
      ['b \u00d7 h', `${sec.b} \u00d7 ${sec.h} mm`],
      ['d', `${d > 0 ? d.toFixed(0) : '\u2014'} mm`],
      ['Ast', `${Math.round(Ast)} mm\u00b2`],
      ['As_steel', `${sec.steelArea} mm\u00b2`],
      ['\u03c1g', `${Ag > 0 ? (Ast / Ag * 100).toFixed(2) : '\u2014'}%`],
    ]
    : [
      ['b \u00d7 h', `${sec.b} \u00d7 ${sec.h} mm`],
      ['d', `${d > 0 ? d.toFixed(0) : '\u2014'} mm`],
      ['Ast', `${Math.round(Ast)} mm\u00b2`],
      ['\u03c1g', `${Ag > 0 ? (Ast / Ag * 100).toFixed(2) : '\u2014'}%`],
    ]

  // ── Design Parameters items ──
  const designParams: [string, string][] = [
    ['fck', `${mat.fck} MPa`],
    ['fy', `${mat.fy} MPa`],
    ...(sec.shape === 'circular'
      ? [['D', `${sec.D}`] as [string, string]]
      : [['b \u00d7 h', `${sec.b}\u00d7${sec.h}`] as [string, string]]
    ),
    ['d / d\'', `${d > 0 ? d.toFixed(0) : '-'} / ${d_prime.toFixed(0)}`],
    ['주근', sec.shape === 'circular'
      ? `${reb.nCircular}-D${reb.dia} (원형)`
      : `${nBar}-D${reb.dia} (T${reb.nTop}/B${reb.nBot}/L${reb.nLeft}/R${reb.nRight}+4코너)`
    ],
    ['Ast', `${Math.round(Ast)} mm\u00b2`],
    ...(tie.transverseType === 'tie'
      ? [['타이', `D${tie.dia}@${tie.spacing}-${tie.legs}leg`] as [string, string]]
      : [['나선', `D${tie.spiralDia}@${tie.spiralPitch}`] as [string, string]]
    ),
    ['조합수', `${loads.length}개`],
    ['하중(현)', `Pu=${load.Pu} / Mu=${Math.sqrt(load.Mux ** 2 + load.Muy ** 2).toFixed(0)}`],
    ...(sec.shape === 'composite'
      ? [['강재', `${sec.steelArea} mm\u00b2`] as [string, string]]
      : []
    ),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>

      {/* 모바일/태블릿 탭 바 */}
      {isCompact && <TabBar />}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ══ 좌측: 입력 패널 (트리형) ══ */}
      <div style={{
        width: isCompact ? '100%' : 'clamp(240px, 26%, 320px)',
        flexShrink: 0,
        display: showInput ? 'flex' : 'none',
        flexDirection: 'column',
        borderRight: isCompact ? 'none' : '1px solid var(--border-dark)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}>
        {/* 패널 제목 */}
        <div style={{
          padding: '0.35rem 0.65rem',
          background: 'var(--surface-3)',
          borderBottom: '1px solid var(--border-dark)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            color: 'var(--text-3)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          }}>RC Column Section Design</span>
        </div>

        {/* 입력 목록 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* 재료 */}
          <GroupHeader title="Material" sub="KDS 14 20 01"/>
          <Row label="fck (MPa)">
            <NumInput value={mat.fck} min={21} step={3} onChange={v => setMat(m => ({ ...m, fck: v }))}/>
          </Row>
          <Row label="fy (MPa)">
            <NumInput value={mat.fy} min={300} step={50} onChange={v => setMat(m => ({ ...m, fy: v }))}/>
          </Row>
          <Row label="Es (MPa)">
            <NumInput value={mat.Es} step={1000} onChange={v => setMat(m => ({ ...m, Es: v }))}/>
          </Row>

          {/* 단면 형상 선택 */}
          <GroupHeader title="Section Shape" sub="단면 형상"/>
          <ToggleButtons<ColumnShape>
            value={sec.shape}
            options={[
              { v: 'rectangular', label: '직사각형' },
              { v: 'circular', label: '원형' },
              { v: 'composite', label: '합성(SRC)' },
            ]}
            onChange={v => setSec(s => ({ ...s, shape: v }))}
          />

          {/* ── 적용 설계기준 표기 ── */}
          <div style={{
            margin: '0.3rem 0.4rem 0.1rem',
            border: '1px solid var(--border-dark)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}>
            <div style={{
              background: 'var(--surface-3)',
              borderBottom: '1px solid var(--border-dark)',
              padding: '0.2rem 0.55rem',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{
                fontSize: '0.61rem', fontWeight: 800,
                color: 'var(--text-3)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
              }}>적용 설계기준</span>
              <span style={{
                fontSize: '0.58rem', color: 'var(--text-disabled)',
                fontFamily: 'var(--font-mono)',
              }}>KDS 2022</span>
            </div>
            {([
              ['KDS 14 20 20', '휨 및 압축 (기둥강도 · P-M 상호작용)'],
              ['KDS 14 20 22', '전단 및 비틀림 (전단강도 Vc)'],
              ['KDS 14 20 01', '일반사항 (재료기준 · 강도감소계수 φ)'],
            ] as const).map(([code, desc]) => (
              <div key={code} style={{
                display: 'grid',
                gridTemplateColumns: '7.8rem 1fr',
                borderBottom: '1px solid var(--border-light)',
                alignItems: 'stretch',
              }}>
                <div style={{
                  padding: '0.18rem 0.45rem',
                  borderRight: '1px solid var(--border-light)',
                  background: 'var(--primary-bg)',
                  display: 'flex', alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 700,
                    color: 'var(--primary)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.02em',
                  }}>{code}</span>
                </div>
                <div style={{ padding: '0.18rem 0.45rem', display: 'flex', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '0.66rem', color: 'var(--text-2)',
                    fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
                    lineHeight: 1.4,
                  }}>{desc}</span>
                </div>
              </div>
            ))}
            <div style={{ padding: '0.16rem 0.5rem', background: 'var(--surface-2)' }}>
              <span style={{
                fontSize: '0.61rem', color: 'var(--text-3)',
                fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
              }}>건축·일반 RC 구조물 대상 &middot; 도로교(KDS 24) 미적용</span>
            </div>
          </div>

          {/* 단면 치수 — shape dependent */}
          <GroupHeader title="Section" sub="mm"/>
          {sec.shape === 'circular' ? (
            <>
              <Row label="D — 직경">
                <NumInput value={sec.D} min={0} step={50} onChange={v => setSec(s => ({ ...s, D: v }))}/>
              </Row>
            </>
          ) : (
            <>
              <Row label="b — 폭">
                <NumInput value={sec.b} min={0} step={50} onChange={v => setSec(s => ({ ...s, b: v }))}/>
              </Row>
              <Row label="h — 깊이">
                <NumInput value={sec.h} min={0} step={50} onChange={v => setSec(s => ({ ...s, h: v }))}/>
              </Row>
            </>
          )}

          {/* Composite: steel section inputs */}
          {sec.shape === 'composite' && (
            <>
              <GroupHeader title="Steel Section" sub="강재 (SRC)"/>
              <Row label="강재 형상">
                <input type="text" value={sec.steelShape}
                  onChange={e => setSec(s => ({ ...s, steelShape: e.target.value }))}
                  style={{ width: '100%', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
                />
              </Row>
              <Row label="As_steel (mm\u00b2)">
                <NumInput value={sec.steelArea} min={0} step={100} onChange={v => setSec(s => ({ ...s, steelArea: v }))}/>
              </Row>
              <Row label="Fy_steel (MPa)">
                <NumInput value={sec.steelFy} min={200} step={10} onChange={v => setSec(s => ({ ...s, steelFy: v }))}/>
              </Row>
            </>
          )}

          {/* 피복 입력 방식 토글 */}
          <div style={{
            display: 'flex', gap: '0', margin: '0.2rem 0.4rem',
            border: '1px solid var(--border-dark)', borderRadius: '2px', overflow: 'hidden',
          }}>
            {([
              ['stirrup', '타이 외면까지'],
              ['center', '철근 중심까지'],
            ] as const).map(([mode, label]) => (
              <button key={mode}
                onClick={() => setSec(s => ({ ...s, coverMode: mode, cover: mode === 'stirrup' ? 40 : 65 }))}
                style={{
                  flex: 1, border: 'none', padding: '0.22rem 0',
                  fontSize: '0.63rem', fontWeight: 700,
                  fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  background: sec.coverMode === mode ? 'var(--primary)' : 'var(--surface-2)',
                  color: sec.coverMode === mode ? '#fff' : 'var(--text-3)',
                  letterSpacing: '0.01em',
                }}>{label}</button>
            ))}
          </div>
          <Row label={sec.coverMode === 'stirrup' ? '피복 (타이외면)' : '피복 (철근중심)'}>
            <NumInput value={sec.cover} min={0} step={5} onChange={v => setSec(s => ({ ...s, cover: v }))}/>
          </Row>
          <div style={{
            padding: '0.1rem 0.55rem 0.18rem',
            fontSize: '0.62rem', color: 'var(--text-3)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border-light)',
          }}>
            {sec.coverMode === 'stirrup'
              ? `d' = cover + D${transverseDia} + D${reb.dia}/2 = ${d_prime.toFixed(0)} mm`
              : `d' = cover = ${sec.cover} mm  (철근 중심 기준)`}
          </div>

          <Row label="d — 유효깊이">
            <div style={{ padding: '0.1rem 0.3rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                {d > 0 ? d.toFixed(0) : '\u2014'}
              </span>
              <span style={{ fontSize: '0.63rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                mm (자동)
              </span>
            </div>
          </Row>

          {/* 주근 */}
          <GroupHeader title="Longitudinal Rebar" sub="주근"/>
          <Row label="철근 직경">
            <SelInput value={reb.dia} options={rebarOptions}
              onChange={v => setReb(r => ({ ...r, dia: v as number }))}/>
          </Row>

          {/* 직사각형/합성: 방향별 개수 입력 */}
          {sec.shape !== 'circular' ? (
            <div>
              {/* 입력 그리드 — 방향 위치 시각화 */}
              <div style={{
                padding: '0.55rem 0.5rem 0.4rem',
                background: 'var(--surface-2)',
                borderBottom: '1px solid var(--border-light)',
              }}>
                {/* 안내 텍스트 */}
                <div style={{
                  fontSize: '0.6rem', color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)', marginBottom: '0.45rem',
                  lineHeight: 1.5,
                }}>
                  각 면 코너 <strong>제외</strong> 중간 철근 수 입력<br/>
                  <span style={{ color: 'var(--primary)' }}>총 = 4(코너) + T + B + L + R = {nBar}개</span>
                </div>

                {/* 방향별 그리드: 십자 배치 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr 1fr',
                  gridTemplateRows: 'auto auto auto',
                  gap: '3px',
                  alignItems: 'center',
                }}>
                  {/* 상단 (Top) */}
                  <div/>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Top</span>
                    <input type="number" value={reb.nTop} min={0} step={1}
                      onChange={e => setReb(r => ({ ...r, nTop: Math.max(0, Number(e.target.value)) }))}
                      style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                    />
                  </div>
                  <div/>

                  {/* 중간 행: Left — 단면 미니뷰 — Right */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Left</span>
                    <input type="number" value={reb.nLeft} min={0} step={1}
                      onChange={e => setReb(r => ({ ...r, nLeft: Math.max(0, Number(e.target.value)) }))}
                      style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                    />
                  </div>

                  {/* 단면 미니뷰 SVG */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '2px',
                  }}>
                    <svg viewBox="0 0 60 60" width="60" height="60" style={{ display: 'block' }}>
                      {/* 단면 외곽 */}
                      <rect x="4" y="4" width="52" height="52" fill="#f0f2f5" stroke="#6b7a99" strokeWidth="1.5"/>
                      {/* 타이 점선 */}
                      <rect x="10" y="10" width="40" height="40" fill="none" stroke="var(--primary)" strokeWidth="0.8" strokeDasharray="3 2"/>
                      {/* 코너 4개 — 항상 표시 */}
                      {[
                        [12, 12], [48, 12], [12, 48], [48, 48]
                      ].map(([cx, cy], i) => (
                        <circle key={i} cx={cx} cy={cy} r="3.5" fill="#2a3150"/>
                      ))}
                      {/* Top 면 철근 */}
                      {Array.from({ length: reb.nTop }, (_, i) => {
                        const x = 12 + (i + 1) / (reb.nTop + 1) * 36
                        return <circle key={i} cx={x} cy={12} r="3" fill="var(--primary)"/>
                      })}
                      {/* Bottom 면 철근 */}
                      {Array.from({ length: reb.nBot }, (_, i) => {
                        const x = 12 + (i + 1) / (reb.nBot + 1) * 36
                        return <circle key={i} cx={x} cy={48} r="3" fill="var(--primary)"/>
                      })}
                      {/* Left 면 철근 */}
                      {Array.from({ length: reb.nLeft }, (_, i) => {
                        const y = 12 + (i + 1) / (reb.nLeft + 1) * 36
                        return <circle key={i} cx={12} cy={y} r="3" fill="#e06020"/>
                      })}
                      {/* Right 면 철근 */}
                      {Array.from({ length: reb.nRight }, (_, i) => {
                        const y = 12 + (i + 1) / (reb.nRight + 1) * 36
                        return <circle key={i} cx={48} cy={y} r="3" fill="#e06020"/>
                      })}
                    </svg>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Right</span>
                    <input type="number" value={reb.nRight} min={0} step={1}
                      onChange={e => setReb(r => ({ ...r, nRight: Math.max(0, Number(e.target.value)) }))}
                      style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                    />
                  </div>

                  {/* 하단 (Bottom) */}
                  <div/>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Bottom</span>
                    <input type="number" value={reb.nBot} min={0} step={1}
                      onChange={e => setReb(r => ({ ...r, nBot: Math.max(0, Number(e.target.value)) }))}
                      style={{ width: '100%', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                    />
                  </div>
                  <div/>
                </div>

                {/* 총 개수 표시 */}
                <div style={{
                  marginTop: '0.4rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.22rem 0.4rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border-dark)',
                  borderRadius: '2px',
                }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    총 주근 수
                  </span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                    {nBar}개
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* 원형: 총 개수 직접 입력 */
            <Row label="총 개수 (개)">
              <NumInput value={reb.nCircular} min={6} step={2}
                onChange={v => setReb(r => ({ ...r, nCircular: v }))}/>
            </Row>
          )}

          {/* 횡보강근 */}
          <GroupHeader title="Transverse Reinf." sub="횡보강근"/>
          <ToggleButtons<TransverseType>
            value={tie.transverseType}
            options={[
              { v: 'tie', label: '띠철근' },
              { v: 'spiral', label: '나선철근' },
            ]}
            onChange={v => setTie(t => ({ ...t, transverseType: v }))}
          />
          {tie.transverseType === 'tie' ? (
            <>
              <Row label="타이 직경">
                <SelInput value={tie.dia} options={tieOptions}
                  onChange={v => setTie(t => ({ ...t, dia: v as number }))}/>
              </Row>
              <Row label="다리수 (legs)">
                <SelInput value={tie.legs}
                  options={[2, 3, 4].map(n => ({ v: n, label: `${n}-leg  (Av = ${n}\u00d7${REBAR_AREA[tie.dia] ?? 0} mm\u00b2)` }))}
                  onChange={v => setTie(t => ({ ...t, legs: v as number }))}/>
              </Row>
              <Row label="간격 s (mm)">
                <NumInput value={tie.spacing} min={50} step={25}
                  onChange={v => setTie(t => ({ ...t, spacing: v }))}/>
              </Row>
            </>
          ) : (
            <>
              <Row label="나선 직경">
                <SelInput value={tie.spiralDia} options={tieOptions}
                  onChange={v => setTie(t => ({ ...t, spiralDia: v as number }))}/>
              </Row>
              <Row label="피치 (mm)">
                <NumInput value={tie.spiralPitch} min={25} step={5}
                  onChange={v => setTie(t => ({ ...t, spiralPitch: v }))}/>
              </Row>
              <div style={{
                padding: '0.1rem 0.55rem 0.18rem',
                fontSize: '0.62rem', color: 'var(--text-3)',
                fontFamily: 'var(--font-mono)',
                background: 'var(--surface-2)',
                borderBottom: '1px solid var(--border-light)',
              }}>
                25mm \u2264 pitch \u2264 75mm
              </div>
            </>
          )}

          {/* 하중 조합 */}
          <GroupHeader title="Load Combinations" sub="다중조합"/>

          {/* 조합 탭 + 추가 버튼 */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '2px',
            padding: '0.3rem 0.4rem 0',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border-dark)',
            alignItems: 'center',
          }}>
            {loads.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveLoadIdx(i)}
                  style={{
                    border: 'none', padding: '0.18rem 0.45rem',
                    fontSize: '0.62rem', fontWeight: 700,
                    fontFamily: 'var(--font-mono)', cursor: 'pointer',
                    borderRadius: '2px 0 0 2px',
                    background: activeLoadIdx === i ? 'var(--primary)' : 'var(--surface-3)',
                    color: activeLoadIdx === i ? '#fff' : 'var(--text-3)',
                    borderRight: '1px solid var(--border-dark)',
                  }}
                >
                  {l.name}
                  {/* 해당 조합 결과 뱃지 */}
                  {' '}
                  <span style={{
                    fontSize: '0.55rem',
                    color: allResults[i]?.overallStatus === 'NG' ? '#ff6b6b'
                      : allResults[i]?.overallStatus === 'WARN' ? '#f0a020'
                      : '#4caf50',
                    fontWeight: 900,
                  }}>
                    {allResults[i]?.overallStatus === 'NG' ? '✗' : allResults[i]?.overallStatus === 'WARN' ? '△' : '✓'}
                  </span>
                </button>
                {loads.length > 1 && (
                  <button
                    onClick={() => removeLoad(i)}
                    style={{
                      border: 'none', padding: '0.18rem 0.3rem',
                      fontSize: '0.6rem', fontWeight: 700,
                      fontFamily: 'var(--font-mono)', cursor: 'pointer',
                      borderRadius: '0 2px 2px 0',
                      background: activeLoadIdx === i ? '#c0392b' : 'var(--surface-3)',
                      color: activeLoadIdx === i ? '#fff' : 'var(--text-disabled)',
                    }}
                    title="조합 삭제"
                  >×</button>
                )}
              </div>
            ))}
            <button
              onClick={addLoad}
              style={{
                border: '1px dashed var(--border-dark)',
                padding: '0.18rem 0.5rem',
                fontSize: '0.62rem', fontWeight: 700,
                fontFamily: 'var(--font-mono)', cursor: 'pointer',
                borderRadius: '2px',
                background: 'transparent',
                color: 'var(--primary)',
              }}
              title="조합 추가"
            >+ 추가</button>
          </div>

          {/* 선택된 조합 이름 편집 */}
          <Row label="조합 이름">
            <input
              type="text"
              value={load.name}
              onChange={e => updateLoad(l => ({ ...l, name: e.target.value }))}
              style={{ width: '100%', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
            />
          </Row>

          <Row label="Pu (kN)">
            <NumInput value={load.Pu} min={0} step={50} onChange={v => updateLoad(l => ({ ...l, Pu: v }))}/>
          </Row>
          <Row label="Mux (kN·m)">
            <NumInput value={load.Mux} min={0} step={5} onChange={v => updateLoad(l => ({ ...l, Mux: v }))}/>
          </Row>
          <Row label="Muy (kN·m)">
            <NumInput value={load.Muy} min={0} step={5} onChange={v => updateLoad(l => ({ ...l, Muy: v }))}/>
          </Row>
          <Row label="Vu (kN)">
            <NumInput value={load.Vu} min={0} step={5} onChange={v => updateLoad(l => ({ ...l, Vu: v }))}/>
          </Row>
          <RowWithTooltip label="lu (mm)" tooltip={<LuTooltip />}>
            <NumInput value={load.lu} min={0} step={100} onChange={v => updateLoad(l => ({ ...l, lu: v }))}/>
          </RowWithTooltip>
          <RowWithTooltip label="K (유효길이)" tooltip={<KTooltip />}>
            <NumInput value={load.k} min={0.5} step={0.1} onChange={v => updateLoad(l => ({ ...l, k: v }))}/>
          </RowWithTooltip>

        </div>

        {/* 단면 요약 (하단 고정) */}
        <div style={{
          borderTop: '1px solid var(--border-dark)',
          background: 'var(--surface-2)',
        }}>
          <div style={{
            padding: '0.28rem 0.6rem',
            background: 'var(--surface-3)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: '0.65rem', fontWeight: 700,
            color: 'var(--text-disabled)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          }}>Section Summary</div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            padding: '0.3rem 0.5rem', gap: '0.1rem',
          }}>
            {summaryItems.map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.1rem 0.15rem',
              }}>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{k}</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 중앙: 단면도 + Design Parameters ══ */}
      <div style={{
        width: isCompact ? '100%' : 'clamp(240px, 30%, 360px)',
        flexShrink: 0,
        display: showSection ? 'flex' : 'none',
        flexDirection: 'column',
        borderRight: isCompact ? 'none' : '1px solid var(--border-dark)',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}>
        {/* 단면도 헤더 */}
        <div style={{
          padding: '0.3rem 0.65rem',
          background: 'var(--surface-3)',
          borderBottom: '1px solid var(--border-dark)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            color: 'var(--text-3)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          }}>Section View</span>
          <StatusBadge status={worstStatus}/>
        </div>

        {/* ── 상단: 단면도 ── */}
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          minHeight: 0,
          background: sectionValid ? undefined : 'var(--surface-2)',
          borderBottom: '1px solid var(--border-dark)',
        }}>
          {sectionValid
            ? <ColumnDiagram sec={sec} reb={reb} tie={tie} width={340} height={260}/>
            : <span style={{
                display: 'flex', alignItems: 'center',
                fontSize: '0.75rem', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)'
              }}>
                {sec.shape === 'circular' ? 'D 값을 입력하면 단면도가 표시됩니다' : 'b, h 값을 입력하면 단면도가 표시됩니다'}
              </span>
          }
        </div>

        {/* ── 하단: P-M 상관도 ── */}
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          {/* P-M 헤더 */}
          <div style={{
            padding: '0.15rem 0.6rem',
            background: 'var(--surface-3)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: '0.6rem', fontWeight: 700,
            color: 'var(--text-disabled)',
            letterSpacing: '0.07em', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}>{loads[activeResultIdx]?.name ?? ''} — P-M Interaction  (KDS 14 20 20)</div>
          <div style={{
            flex: 1,
            display: 'flex', alignItems: 'stretch',
            padding: '2px',
            overflow: 'hidden',
            minHeight: 0,
          }}>
            {sectionValid
              ? <PMDiagram
                  mat={mat} sec={sec} reb={reb} tie={tie}
                  load={loads[activeResultIdx] ?? loads[0]}
                  rho_g={rho_g}
                />
              : null
            }
          </div>
        </div>

        {/* Design Parameters 컴팩트 테이블 */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border-dark)',
          background: 'var(--surface)',
          overflow: 'hidden',
        }}>
          {/* 헤더 */}
          <div style={{
            padding: '0.22rem 0.6rem',
            background: 'var(--surface-3)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: '0.62rem', fontWeight: 700,
            color: 'var(--text-disabled)',
            letterSpacing: '0.07em', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          }}>Design Parameters</div>

          {/* 2열 컴팩트 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {designParams.map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', alignItems: 'center',
                borderBottom: '1px solid var(--border-light)',
                borderRight: '1px solid var(--border-light)',
                minHeight: '1.55rem',
              }}>
                <span style={{
                  padding: '0.15rem 0.35rem',
                  fontSize: '0.6rem', fontWeight: 600,
                  color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  borderRight: '1px solid var(--border-light)',
                  background: 'var(--surface-2)',
                  alignSelf: 'stretch',
                  display: 'flex', alignItems: 'center',
                  minWidth: '3.2rem',
                }}>{k}</span>
                <span style={{
                  padding: '0.15rem 0.3rem',
                  fontSize: '0.67rem', fontWeight: 600,
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ 우측: 검토결과 ══ */}
      <div style={{ flex: 1, display: showResult ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>

        {/* 헤더 */}
        <div style={{
          padding: '0.3rem 0.65rem',
          background: 'var(--surface-3)',
          borderBottom: '1px solid var(--border-dark)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            color: 'var(--text-3)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          }}>Check Results</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
              종합
            </span>
            <StatusBadge status={worstStatus}/>
          </div>
        </div>

        {/* 조합 선택 탭 (결과 패널) */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '2px',
          padding: '0.25rem 0.4rem',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border-dark)',
          flexShrink: 0,
        }}>
          {loads.map((l, i) => {
            const st = allResults[i]?.overallStatus
            return (
              <button key={i}
                onClick={() => setActiveResultIdx(i)}
                style={{
                  border: 'none', padding: '0.2rem 0.6rem',
                  fontSize: '0.62rem', fontWeight: 700,
                  fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  borderRadius: '2px',
                  background: activeResultIdx === i ? 'var(--primary)' : 'var(--surface-3)',
                  color: activeResultIdx === i ? '#fff' : 'var(--text-3)',
                  borderBottom: activeResultIdx === i
                    ? '2px solid var(--primary)'
                    : `2px solid ${st === 'NG' ? '#ff6b6b' : st === 'WARN' ? '#f0a020' : '#4caf50'}`,
                }}
              >
                {l.name}
                {' '}
                <span style={{
                  fontSize: '0.58rem', fontWeight: 900,
                  color: activeResultIdx === i ? 'rgba(255,255,255,0.85)'
                    : st === 'NG' ? '#ff6b6b' : st === 'WARN' ? '#f0a020' : '#4caf50',
                }}>
                  {st === 'NG' ? 'N.G' : st === 'WARN' ? 'WARN' : 'O.K'}
                </span>
              </button>
            )
          })}
        </div>

        {/* 선택된 조합 하중 요약 */}
        <div style={{
          padding: '0.2rem 0.65rem',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex', gap: '1rem', flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          {[
            ['Pu', `${loads[activeResultIdx]?.Pu ?? 0} kN`],
            ['Mux', `${loads[activeResultIdx]?.Mux ?? 0} kN·m`],
            ['Muy', `${loads[activeResultIdx]?.Muy ?? 0} kN·m`],
            ['Vu', `${loads[activeResultIdx]?.Vu ?? 0} kN`],
          ].map(([k, v]) => (
            <span key={k} style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              <span style={{ color: 'var(--text-disabled)' }}>{k} </span>
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>{v}</span>
            </span>
          ))}
        </div>

        {/* 결과 스크롤 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>

          {/* 경고 */}
          {result.warnings.length > 0 && (
            <div style={{
              background: 'var(--warning-bg)',
              border: '1px solid #f0c070',
              borderLeft: '3px solid var(--warning)',
              borderRadius: '2px',
              padding: '0.4rem 0.65rem',
              marginBottom: '0.5rem',
              display: 'flex', flexDirection: 'column', gap: '0.15rem',
            }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={{
                  fontSize: '0.72rem', color: 'var(--warning)',
                  fontFamily: 'var(--font-mono)',
                  display: 'flex', gap: '0.5rem',
                }}>
                  <span style={{ flexShrink: 0, fontWeight: 700 }}>!</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <ResultTable items={result.items} overallStatus={result.overallStatus}/>
        </div>
      </div>
      </div>{/* 3열 컨테이너 닫기 */}
    </div>
  )
}
