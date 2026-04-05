import { useState } from 'react'
import type { CheckResult, CheckItem, CalcLine } from '../../types'
import { useResponsive } from '../../hooks/useResponsive'
import ResultTable from '../common/ResultTable'

// ── 철근 단면적 (mm²) ──────────────────────────────────────
const REBAR_AREA: Record<number, number> = {
  10: 71.3, 13: 126.7, 16: 198.6, 19: 286.5,
  22: 387.1, 25: 506.7, 29: 642.4, 32: 794.2, 35: 956.6,
}

// ── 입력 타입 ──────────────────────────────────────────────
interface WallMaterial {
  fck: number
  fy: number
  Es: number
}
interface WallSection {
  tw: number     // 벽체 두께 (mm)
  lw: number     // 벽체 길이 (mm)
  hw: number     // 벽체 높이 (mm)
  cover: number  // 피복두께 (mm)
}
interface WallVerticalRebar {
  dia: number
  spacing: number  // sv (mm)
  layers: 1 | 2    // 1겹 or 2겹 (curtains)
}
interface WallHorizontalRebar {
  dia: number
  spacing: number  // sh (mm)
  layers: 1 | 2
}
interface WallLoad {
  Pu: number  // 축력 (kN, 압축+)
  Vu: number  // 면내 전단력 (kN)
  Mu: number  // 면내 휨모멘트 (kN·m)
}

// ── 기본값 ──────────────────────────────────────────────────
const DEFAULT_MAT: WallMaterial = { fck: 27, fy: 400, Es: 200000 }
const DEFAULT_SEC: WallSection  = { tw: 200, lw: 3000, hw: 3000, cover: 40 }
const DEFAULT_VBAR: WallVerticalRebar   = { dia: 13, spacing: 200, layers: 2 }
const DEFAULT_HBAR: WallHorizontalRebar = { dia: 13, spacing: 200, layers: 2 }
const DEFAULT_LOAD: WallLoad = { Pu: 0, Vu: 0, Mu: 0 }

// ── KDS 14 20 70/22 : RC Wall 계산 엔진 ──────────────────────
function calcWall(
  mat: WallMaterial,
  sec: WallSection,
  vbar: WallVerticalRebar,
  hbar: WallHorizontalRebar,
  load: WallLoad,
): CheckResult {
  const { fck, fy, Es } = mat
  const { tw, lw, hw, cover } = sec
  const lambda = 1.0

  // 유효깊이
  const d = 0.8 * lw

  // 수직 철근량 (per 1m = 1000mm)
  const Av_bar = REBAR_AREA[vbar.dia] ?? 0
  const Av_per_m = (Math.PI / 4 * vbar.dia * vbar.dia > 0 ? Av_bar : 0) * (1000 / vbar.spacing) * vbar.layers
  const rho_v = Av_per_m / (tw * 1000)

  // 수평 철근량 (per 1m = 1000mm)
  const Ah_bar = REBAR_AREA[hbar.dia] ?? 0
  const Ah_per_m = Ah_bar * (1000 / hbar.spacing) * hbar.layers
  const rho_h = Ah_per_m / (tw * 1000)

  // 콘크리트 전단강도
  const Vc1 = 0.27 * lambda * Math.sqrt(fck) * tw * d * 1e-3
  const Nu_N = load.Pu * 1000  // kN → N
  const Vc2_val = (0.05 * lambda * Math.sqrt(fck) + (Nu_N * d) / (4 * lw * tw * d)) * tw * d * 1e-3
  const Vc = Math.min(Vc1, Vc2_val)

  const phi_v = 0.75

  // 최소 철근비 판정 기준
  const needHighRatio = load.Vu > 0.5 * phi_v * Vc

  // 수직근 최소 철근비
  const rho_v_min = needHighRatio ? 0.0025 : 0.0012
  // 수평근 최소 철근비
  const rho_h_min = needHighRatio ? 0.0025 : 0.0020

  // 철근 전단강도
  const Ah_per_s = Ah_bar * hbar.layers  // 수평근 1조 (양면)
  const Vs = Ah_per_s * fy * d / hbar.spacing * 1e-3

  // 최대 전단강도 상한
  const Vn_max = 0.83 * Math.sqrt(fck) * tw * d * 1e-3
  const Vn = Math.min(Vc + Vs, Vn_max)
  const phi_Vn = phi_v * Vn
  const phi_Vn_max = phi_v * Vn_max

  // 휨 검토
  const As_v_total = Av_per_m * lw / 1000
  const beta1 = fck <= 28 ? 0.85 : Math.max(0.85 - 0.007 * (fck - 28), 0.65)
  const a_flex = (As_v_total * fy + load.Pu * 1000) / (0.85 * fck * tw)
  const c_flex = a_flex / beta1
  const ey = fy / Es
  const et = d > c_flex ? 0.003 * (d - c_flex) / c_flex : 0

  let phi_f: number
  if (et >= 0.005)     phi_f = 0.85
  else if (et <= ey)   phi_f = 0.65
  else                 phi_f = 0.65 + 0.2 * (et - ey) / (0.005 - ey)

  const Mn = As_v_total * fy * (0.5 * lw - a_flex / 2) * 1e-6
           + load.Pu * (0.5 * lw - a_flex / 2) * 1e-3
  const phi_Mn = phi_f * Mn

  // 벽체 두께 최소값
  const tw_min = Math.max(hw / 25, 100)

  // ── CalcLine 헬퍼 ──
  const csec = (text: string): CalcLine => ({ type: 'section', text })
  const eq   = (text: string, value?: string, indent = 0): CalcLine => ({ type: 'eq', text, value, indent })
  const eqk  = (text: string, value?: string, indent = 0): CalcLine => ({ type: 'eq-key', text, value, indent })
  const res  = (text: string, value?: string): CalcLine => ({ type: 'result', text, value })
  const verd = (text: string, ok: boolean): CalcLine => ({ type: 'verdict', text, value: ok ? 'O.K' : 'N.G' })
  const note = (text: string): CalcLine => ({ type: 'note', text })

  // SF helpers
  const SF_thick = tw / tw_min
  const SF_rhov  = rho_v / rho_v_min
  const SF_rhoh  = rho_h / rho_h_min
  const SF_shear = load.Vu > 0 ? phi_Vn / load.Vu : Infinity
  const SF_flex  = load.Mu > 0 ? phi_Mn / load.Mu : Infinity
  const SF_max   = load.Vu > 0 ? phi_Vn_max / load.Vu : Infinity

  const items: CheckItem[] = [

    // ════════════════════════════════════════════════════════
    // ① 벽체 두께 검토  (KDS 14 20 70)
    // ════════════════════════════════════════════════════════
    {
      id: 'wall-thickness', label: '① 벽체 두께 검토',
      demandSymbol: 'tw,min', capacitySymbol: 'tw',
      demand: tw_min, capacity: tw, unit: 'mm',
      ratio: tw_min / tw, SF: SF_thick,
      status: tw >= tw_min ? 'OK' : 'NG',
      formula: `tw = ${tw} mm   tw,min = ${tw_min.toFixed(0)} mm   S.F = ${SF_thick.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 최소 벽체 두께  (KDS 14 20 70)'),
        note('일반 벽체: tw,min = max(hw/25, 100 mm)'),
        eq(`hw / 25`, `${hw} / 25 = ${(hw / 25).toFixed(1)} mm`),
        eq(`100 mm`, `100 mm  (절대 최소)`),
        eqk(`tw,min = max(hw/25, 100)`, `max(${(hw / 25).toFixed(1)}, 100) = ${tw_min.toFixed(0)} mm`),

        csec('2. 제공 벽체 두께'),
        eqk(`tw`, `${tw} mm`),

        csec('3. 검토'),
        res(`tw = ${tw} mm`, `tw,min = ${tw_min.toFixed(0)} mm`),
        verd(`tw ${tw >= tw_min ? '≥' : '<'} tw,min  →  S.F = ${SF_thick.toFixed(3)}`, tw >= tw_min),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ② 수직 철근비 검토  (KDS 14 20 70)
    // ════════════════════════════════════════════════════════
    {
      id: 'rho-vertical', label: '② 수직 철근비 검토',
      demandSymbol: 'ρv,min', capacitySymbol: 'ρv',
      demand: rho_v_min, capacity: rho_v, unit: '',
      ratio: rho_v_min / rho_v, SF: SF_rhov,
      status: rho_v >= rho_v_min ? 'OK' : 'NG',
      formula: `ρv = ${rho_v.toFixed(5)}   ρv,min = ${rho_v_min.toFixed(4)}   S.F = ${SF_rhov.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 수직 철근 단면적 (1m당)'),
        note('Av_per_m = Ab × (1000/sv) × n_curtain'),
        eq(`Ab (D${vbar.dia} 1본)`, `${Av_bar.toFixed(1)} mm²`),
        eq(`Av_per_m = ${Av_bar.toFixed(1)} × (1000/${vbar.spacing}) × ${vbar.layers}`,
           `${Av_bar.toFixed(1)} × ${(1000 / vbar.spacing).toFixed(1)} × ${vbar.layers}`),
        eqk(`Av_per_m`, `${Av_per_m.toFixed(1)} mm²/m`),

        csec('2. 수직 철근비'),
        eq(`ρv = Av_per_m / (tw × 1000)`, `${Av_per_m.toFixed(1)} / (${tw} × 1000)`),
        eqk(`ρv`, `${rho_v.toFixed(5)}`),

        csec('3. 최소 수직 철근비  (KDS 14 20 70)'),
        note(`Vu > 0.5φVc 여부: Vu = ${load.Vu} kN, 0.5φVc = ${(0.5 * phi_v * Vc).toFixed(2)} kN`),
        eq(`0.5·φ·Vc`, `0.5 × ${phi_v} × ${Vc.toFixed(2)} = ${(0.5 * phi_v * Vc).toFixed(2)} kN`),
        eqk(
          needHighRatio
            ? `Vu > 0.5φVc → ρv,min = 0.0025`
            : `Vu ≤ 0.5φVc → ρv,min = 0.0012`,
          `${rho_v_min}`
        ),

        csec('4. 검토'),
        res(`ρv = ${rho_v.toFixed(5)}`, `ρv,min = ${rho_v_min.toFixed(4)}`),
        verd(`ρv ${rho_v >= rho_v_min ? '≥' : '<'} ρv,min  →  S.F = ${SF_rhov.toFixed(3)}`, rho_v >= rho_v_min),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ③ 수평 철근비 검토  (KDS 14 20 70)
    // ════════════════════════════════════════════════════════
    {
      id: 'rho-horizontal', label: '③ 수평 철근비 검토',
      demandSymbol: 'ρh,min', capacitySymbol: 'ρh',
      demand: rho_h_min, capacity: rho_h, unit: '',
      ratio: rho_h_min / rho_h, SF: SF_rhoh,
      status: rho_h >= rho_h_min ? 'OK' : 'NG',
      formula: `ρh = ${rho_h.toFixed(5)}   ρh,min = ${rho_h_min.toFixed(4)}   S.F = ${SF_rhoh.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 수평 철근 단면적 (1m당)'),
        note('Ah_per_m = Ab × (1000/sh) × n_curtain'),
        eq(`Ab (D${hbar.dia} 1본)`, `${Ah_bar.toFixed(1)} mm²`),
        eq(`Ah_per_m = ${Ah_bar.toFixed(1)} × (1000/${hbar.spacing}) × ${hbar.layers}`,
           `${Ah_bar.toFixed(1)} × ${(1000 / hbar.spacing).toFixed(1)} × ${hbar.layers}`),
        eqk(`Ah_per_m`, `${Ah_per_m.toFixed(1)} mm²/m`),

        csec('2. 수평 철근비'),
        eq(`ρh = Ah_per_m / (tw × 1000)`, `${Ah_per_m.toFixed(1)} / (${tw} × 1000)`),
        eqk(`ρh`, `${rho_h.toFixed(5)}`),

        csec('3. 최소 수평 철근비  (KDS 14 20 70)'),
        note(`Vu > 0.5φVc 여부: Vu = ${load.Vu} kN, 0.5φVc = ${(0.5 * phi_v * Vc).toFixed(2)} kN`),
        eq(`0.5·φ·Vc`, `0.5 × ${phi_v} × ${Vc.toFixed(2)} = ${(0.5 * phi_v * Vc).toFixed(2)} kN`),
        eqk(
          needHighRatio
            ? `Vu > 0.5φVc → ρh,min = 0.0025`
            : `Vu ≤ 0.5φVc → ρh,min = 0.0020`,
          `${rho_h_min}`
        ),

        csec('4. 검토'),
        res(`ρh = ${rho_h.toFixed(5)}`, `ρh,min = ${rho_h_min.toFixed(4)}`),
        verd(`ρh ${rho_h >= rho_h_min ? '≥' : '<'} ρh,min  →  S.F = ${SF_rhoh.toFixed(3)}`, rho_h >= rho_h_min),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ④ 면내 전단 검토  (KDS 14 20 22 / KDS 14 20 70)
    // ════════════════════════════════════════════════════════
    {
      id: 'shear', label: '④ 면내 전단 검토',
      demandSymbol: 'Vu', capacitySymbol: 'φVn',
      demand: load.Vu, capacity: phi_Vn, unit: 'kN',
      ratio: load.Vu > 0 ? load.Vu / phi_Vn : 0, SF: SF_shear,
      status: load.Vu <= phi_Vn ? 'OK' : 'NG',
      formula: `Vu = ${load.Vu} kN   φVn = ${phi_Vn.toFixed(2)} kN   S.F = ${isFinite(SF_shear) ? SF_shear.toFixed(3) : '∞'}`,
      detail: {},
      steps: [
        csec('1. 유효깊이  (KDS 14 20 70)'),
        note('벽체 유효깊이: d = 0.8 × lw'),
        eq(`d = 0.8 × lw`, `0.8 × ${lw}`),
        eqk(`d`, `${d.toFixed(0)} mm`),

        csec('2. 콘크리트 전단강도 Vc'),
        note('λ = 1.0 (보통콘크리트)'),
        eq(`Vc1 = 0.27·λ·√fck·tw·d × 10⁻³`,
           `0.27 × ${lambda} × √${fck} × ${tw} × ${d.toFixed(0)} × 10⁻³`),
        eqk(`Vc1`, `${Vc1.toFixed(3)} kN`),

        note('간략식 상한 (축력 고려):'),
        eq(`Vc2 = [0.05λ√fck + Nu·d/(4·lw·tw·d)] × tw·d × 10⁻³`),
        eq(`Nu = Pu × 1000`, `${load.Pu} × 1000 = ${Nu_N.toFixed(0)} N`),
        eq(`Vc2`, `[0.05×${lambda}×√${fck} + ${Nu_N.toFixed(0)}×${d.toFixed(0)}/(4×${lw}×${tw}×${d.toFixed(0)})] × ${tw}×${d.toFixed(0)} × 10⁻³`),
        eqk(`Vc2`, `${Vc2_val.toFixed(3)} kN`),

        eq(`Vc = min(Vc1, Vc2)`, `min(${Vc1.toFixed(3)}, ${Vc2_val.toFixed(3)})`),
        eqk(`Vc`, `${Vc.toFixed(3)} kN`),

        csec('3. 철근 전단강도 Vs'),
        note('수평 철근에 의한 전단 저항'),
        eq(`Ah_per_s (1조) = Ab × n_curtain`, `${Ah_bar.toFixed(1)} × ${hbar.layers} = ${Ah_per_s.toFixed(1)} mm²`),
        eq(`Vs = Ah_per_s·fy·d / sh × 10⁻³`,
           `${Ah_per_s.toFixed(1)} × ${fy} × ${d.toFixed(0)} / ${hbar.spacing} × 10⁻³`),
        eqk(`Vs`, `${Vs.toFixed(3)} kN`),

        csec('4. 최대 전단강도 상한'),
        eq(`Vn,max = 0.83·√fck·tw·d × 10⁻³`,
           `0.83 × √${fck} × ${tw} × ${d.toFixed(0)} × 10⁻³`),
        eqk(`Vn,max`, `${Vn_max.toFixed(3)} kN`),

        csec('5. 공칭 전단강도 Vn'),
        eq(`Vc + Vs`, `${Vc.toFixed(3)} + ${Vs.toFixed(3)} = ${(Vc + Vs).toFixed(3)} kN`),
        eq(`Vn = min(Vc+Vs, Vn,max)`, `min(${(Vc + Vs).toFixed(3)}, ${Vn_max.toFixed(3)})`),
        eqk(`Vn`, `${Vn.toFixed(3)} kN`),

        csec('6. 설계 전단강도 φVn'),
        eq(`φ = ${phi_v}  (전단, KDS 14 20 01)`),
        eq(`φVn = φ × Vn`, `${phi_v} × ${Vn.toFixed(3)}`),
        eqk(`φVn`, `${phi_Vn.toFixed(3)} kN`),

        csec('7. 검토'),
        res(`Vu = ${load.Vu} kN`, `φVn = ${phi_Vn.toFixed(2)} kN`),
        verd(`Vu ${load.Vu <= phi_Vn ? '≤' : '>'} φVn  →  S.F = ${isFinite(SF_shear) ? SF_shear.toFixed(3) : '∞'}`, load.Vu <= phi_Vn),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ⑤ 휨 검토  (KDS 14 20 70)
    // ════════════════════════════════════════════════════════
    {
      id: 'flexure', label: '⑤ 휨 검토',
      demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: load.Mu, capacity: phi_Mn, unit: 'kN·m',
      ratio: load.Mu > 0 ? load.Mu / phi_Mn : 0, SF: SF_flex,
      status: load.Mu <= phi_Mn ? 'OK' : 'NG',
      formula: `Mu = ${load.Mu} kN·m   φMn = ${phi_Mn.toFixed(2)} kN·m   S.F = ${isFinite(SF_flex) ? SF_flex.toFixed(3) : '∞'}`,
      detail: {},
      steps: [
        csec('1. 전체 수직 철근 면적'),
        note('벽체 전체 수직 철근 = Av_per_m × (lw / 1000)'),
        eq(`Av_per_m`, `${Av_per_m.toFixed(1)} mm²/m`),
        eq(`As_v_total = Av_per_m × lw/1000`, `${Av_per_m.toFixed(1)} × ${lw}/1000`),
        eqk(`As_v_total`, `${As_v_total.toFixed(1)} mm²`),

        csec('2. 등가직사각형 응력블록'),
        note('축력 고려: a = (As·fy + Pu×1000) / (0.85·fck·tw)'),
        eq(`β₁`, `${beta1.toFixed(3)}  (fck = ${fck} MPa)`),
        eq(`a = (${As_v_total.toFixed(1)}×${fy} + ${load.Pu}×1000) / (0.85×${fck}×${tw})`),
        eqk(`a`, `${a_flex.toFixed(2)} mm`),
        eq(`c = a / β₁`, `${a_flex.toFixed(2)} / ${beta1.toFixed(3)}`),
        eqk(`c`, `${c_flex.toFixed(2)} mm`),

        csec('3. 인장철근 변형률 & 강도감소계수'),
        note('d = 0.8 × lw 기준'),
        eq(`εt = 0.003 × (d − c) / c`, `0.003 × (${d.toFixed(0)} − ${c_flex.toFixed(1)}) / ${c_flex.toFixed(1)}`),
        eqk(`εt`, `${et.toFixed(5)}`),
        eq(`εy = fy / Es`, `${fy} / ${Es} = ${ey.toFixed(5)}`),
        eqk(
          et >= 0.005
            ? `εt = ${et.toFixed(5)} ≥ 0.005  →  인장지배`
            : et <= ey
            ? `εt = ${et.toFixed(5)} ≤ εy  →  압축지배`
            : `εt = ${et.toFixed(5)}  전이구간 (선형보간)`,
          `φ = ${phi_f.toFixed(4)}`
        ),

        csec('4. 공칭 휨강도 Mn'),
        note('Mn = As_v_total·fy·(0.5lw − a/2)×10⁻⁶ + Pu·(0.5lw − a/2)×10⁻³'),
        eq(`철근 기여 = ${As_v_total.toFixed(1)} × ${fy} × (${(0.5 * lw).toFixed(0)} − ${(a_flex / 2).toFixed(1)}) × 10⁻⁶`,
           `${(As_v_total * fy * (0.5 * lw - a_flex / 2) * 1e-6).toFixed(4)} kN·m`),
        eq(`축력 기여 = ${load.Pu} × (${(0.5 * lw).toFixed(0)} − ${(a_flex / 2).toFixed(1)}) × 10⁻³`,
           `${(load.Pu * (0.5 * lw - a_flex / 2) * 1e-3).toFixed(4)} kN·m`),
        eqk(`Mn`, `${Mn.toFixed(4)} kN·m`),

        csec('5. 설계 휨강도 φMn'),
        eq(`φMn = φ × Mn`, `${phi_f.toFixed(4)} × ${Mn.toFixed(4)}`),
        eqk(`φMn`, `${phi_Mn.toFixed(4)} kN·m`),

        csec('6. 검토'),
        res(`Mu = ${load.Mu} kN·m`, `φMn = ${phi_Mn.toFixed(2)} kN·m`),
        verd(`Mu ${load.Mu <= phi_Mn ? '≤' : '>'} φMn  →  S.F = ${isFinite(SF_flex) ? SF_flex.toFixed(3) : '∞'}`, load.Mu <= phi_Mn),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ⑥ 최대 전단 상한 검토  (KDS 14 20 22)
    // ════════════════════════════════════════════════════════
    {
      id: 'max-shear', label: '⑥ 최대 전단 상한',
      demandSymbol: 'Vu', capacitySymbol: 'φVn,max',
      demand: load.Vu, capacity: phi_Vn_max, unit: 'kN',
      ratio: load.Vu > 0 ? load.Vu / phi_Vn_max : 0, SF: SF_max,
      status: load.Vu <= phi_Vn_max ? 'OK' : 'NG',
      formula: `Vu = ${load.Vu} kN   φVn,max = ${phi_Vn_max.toFixed(2)} kN   S.F = ${isFinite(SF_max) ? SF_max.toFixed(3) : '∞'}`,
      detail: {},
      steps: [
        csec('1. 최대 전단강도 상한  (KDS 14 20 22)'),
        note('콘크리트 웹 압괴 방지를 위한 전단강도 상한'),
        eq(`Vn,max = 0.83·√fck·tw·d × 10⁻³`),
        eq(`= 0.83 × √${fck} × ${tw} × ${d.toFixed(0)} × 10⁻³`),
        eqk(`Vn,max`, `${Vn_max.toFixed(3)} kN`),

        csec('2. 설계 최대 전단강도'),
        eq(`φ = ${phi_v}  (전단)`),
        eq(`φVn,max = φ × Vn,max`, `${phi_v} × ${Vn_max.toFixed(3)}`),
        eqk(`φVn,max`, `${phi_Vn_max.toFixed(3)} kN`),

        csec('3. 검토'),
        res(`Vu = ${load.Vu} kN`, `φVn,max = ${phi_Vn_max.toFixed(2)} kN`),
        verd(`Vu ${load.Vu <= phi_Vn_max ? '≤' : '>'} φVn,max  →  S.F = ${isFinite(SF_max) ? SF_max.toFixed(3) : '∞'}`, load.Vu <= phi_Vn_max),
      ],
    },
  ]

  const hasNG = items.some(i => i.status === 'NG')
  const maxRatio = Math.max(...items.map(i => i.ratio))

  return {
    moduleId: 'rc-wall', items,
    overallStatus: hasNG ? 'NG' : maxRatio > 0.9 ? 'WARN' : 'OK',
    maxRatio,
    warnings: [
      ...(et < 0.004 ? ['인장지배 변형률 미달 (εt < 0.004) — 연성 확보 검토 필요'] : []),
      ...(rho_v < rho_v_min ? [`수직 철근비 부족 (ρv = ${rho_v.toFixed(5)} < ${rho_v_min})`] : []),
      ...(rho_h < rho_h_min ? [`수평 철근비 부족 (ρh = ${rho_h.toFixed(5)} < ${rho_h_min})`] : []),
    ],
  }
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
  value: number
  options: { v: number; label: string }[]
  onChange: (v: number) => void
}) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%' }}>
      {options.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
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

// ── 벽체 단면도 SVG (평면도) ──────────────────────────────────
function WallSectionDiagram({ sec, vbar, hbar, width = 310, height = 370 }: {
  sec: WallSection
  vbar: WallVerticalRebar
  hbar: WallHorizontalRebar
  width?: number
  height?: number
}) {
  const pad = 50
  const availW = width - pad * 2
  const availH = height - pad * 2

  // 벽체 단면 (평면도): lw(수평) × tw(수직)
  const scaleX = availW / sec.lw
  const scaleY = availH / Math.max(sec.tw, sec.lw * 0.3) // tw가 매우 작으므로 비율 보정
  const scale = Math.min(scaleX, scaleY) * 0.85

  const drawLw = sec.lw * scale
  const drawTw = Math.max(sec.tw * scale, 20) // 최소 표시 두께

  const ox = (width - drawLw) / 2
  const oy = (height - drawTw) / 2

  // 수직 철근 (lw 방향 분포) — 원으로 표시
  const vRebarPositions: { x: number; y: number }[] = []
  const nv = Math.floor(sec.lw / vbar.spacing)
  const vCover = sec.cover * scale / (sec.lw / drawLw * drawLw / drawLw) // 간략화
  const vCoverPx = Math.max(sec.cover / sec.lw * drawLw, 4)
  for (let i = 0; i <= nv; i++) {
    const x = ox + vCoverPx + (drawLw - 2 * vCoverPx) * (i / Math.max(nv, 1))
    // 1겹이면 중앙, 2겹이면 상하단
    if (vbar.layers === 2) {
      const tCoverPx = Math.max(sec.cover / sec.tw * drawTw, 3)
      vRebarPositions.push({ x, y: oy + tCoverPx })
      vRebarPositions.push({ x, y: oy + drawTw - tCoverPx })
    } else {
      vRebarPositions.push({ x, y: oy + drawTw / 2 })
    }
  }

  // 수평 철근 (tw 방향) — 수평선으로 표시
  const hLines: { y: number }[] = []
  if (hbar.layers === 2) {
    const hCoverPx = Math.max(sec.cover / sec.tw * drawTw, 3)
    hLines.push({ y: oy + hCoverPx })
    hLines.push({ y: oy + drawTw - hCoverPx })
  } else {
    hLines.push({ y: oy + drawTw / 2 })
  }

  const rebarR = Math.max(vbar.dia * scale * 0.15, 2.2)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: '100%', maxHeight: '100%' }}>
      {/* 벽체 외곽 */}
      <rect x={ox} y={oy} width={drawLw} height={drawTw}
        fill="var(--surface-2)" stroke="var(--text-2)" strokeWidth={1.5} />

      {/* 수평 철근 (선) */}
      {hLines.map((hl, i) => (
        <line key={`h-${i}`}
          x1={ox + 4} y1={hl.y} x2={ox + drawLw - 4} y2={hl.y}
          stroke="var(--primary)" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
      ))}

      {/* 수직 철근 (점) */}
      {vRebarPositions.map((p, i) => (
        <circle key={`v-${i}`} cx={p.x} cy={p.y} r={rebarR}
          fill="var(--primary)" stroke="var(--primary-dark, var(--primary))" strokeWidth={0.5} />
      ))}

      {/* 치수선: lw (하단) */}
      <line x1={ox} y1={oy + drawTw + 18} x2={ox + drawLw} y2={oy + drawTw + 18}
        stroke="var(--text-3)" strokeWidth={0.7} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
      <line x1={ox} y1={oy + drawTw + 8} x2={ox} y2={oy + drawTw + 24}
        stroke="var(--text-3)" strokeWidth={0.5} />
      <line x1={ox + drawLw} y1={oy + drawTw + 8} x2={ox + drawLw} y2={oy + drawTw + 24}
        stroke="var(--text-3)" strokeWidth={0.5} />
      <text x={ox + drawLw / 2} y={oy + drawTw + 32}
        textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-2)" fontWeight={600}>
        lw = {sec.lw}
      </text>

      {/* 치수선: tw (좌측) */}
      <line x1={ox - 18} y1={oy} x2={ox - 18} y2={oy + drawTw}
        stroke="var(--text-3)" strokeWidth={0.7} />
      <line x1={ox - 24} y1={oy} x2={ox - 8} y2={oy}
        stroke="var(--text-3)" strokeWidth={0.5} />
      <line x1={ox - 24} y1={oy + drawTw} x2={ox - 8} y2={oy + drawTw}
        stroke="var(--text-3)" strokeWidth={0.5} />
      <text x={ox - 22} y={oy + drawTw / 2 + 3}
        textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-2)" fontWeight={600}
        transform={`rotate(-90, ${ox - 22}, ${oy + drawTw / 2 + 3})`}>
        tw = {sec.tw}
      </text>

      {/* 화살표 마커 정의 */}
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-3)" />
        </marker>
      </defs>

      {/* 라벨: Plan View */}
      <text x={width / 2} y={14} textAnchor="middle"
        fontSize="10" fontFamily="var(--font-mono)" fill="var(--text-disabled)" fontWeight={700}
        letterSpacing="0.1em">
        WALL CROSS-SECTION (PLAN)
      </text>
    </svg>
  )
}

// ── 메인 패널 ───────────────────────────────────────────────
export default function WallPanel() {
  const { isCompact } = useResponsive()
  const [mat, setMat]   = useState<WallMaterial>(DEFAULT_MAT)
  const [sec, setSec]   = useState<WallSection>(DEFAULT_SEC)
  const [vbar, setVbar] = useState<WallVerticalRebar>(DEFAULT_VBAR)
  const [hbar, setHbar] = useState<WallHorizontalRebar>(DEFAULT_HBAR)
  const [load, setLoad] = useState<WallLoad>(DEFAULT_LOAD)
  const [activeTab, setActiveTab] = useState<'input' | 'section' | 'result'>('input')

  const result = calcWall(mat, sec, vbar, hbar, load)

  const rebarOptions = [10, 13, 16, 19, 22, 25, 29, 32, 35].map(d => ({
    v: d, label: `D${d}  (${REBAR_AREA[d]} mm²)`
  }))
  const layerOptions = [
    { v: 1, label: '1겹 (single)' },
    { v: 2, label: '2겹 (double)' },
  ]

  // 단면 요약 데이터
  const Av_per_m = (REBAR_AREA[vbar.dia] ?? 0) * (1000 / vbar.spacing) * vbar.layers
  const Ah_per_m = (REBAR_AREA[hbar.dia] ?? 0) * (1000 / hbar.spacing) * hbar.layers
  const rho_v = Av_per_m / (sec.tw * 1000)
  const rho_h = Ah_per_m / (sec.tw * 1000)

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

  // ── 패널 표시 여부 ──
  const showInput   = !isCompact || activeTab === 'input'
  const showSection = !isCompact || activeTab === 'section'
  const showResult  = !isCompact || activeTab === 'result'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>

      {/* 모바일/태블릿 탭 바 */}
      {isCompact && <TabBar />}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ══ 좌측: 입력 패널 ══ */}
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
          }}>RC Wall Section Design</span>
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

          {/* 벽체 단면 */}
          <GroupHeader title="Wall Section" sub="mm"/>
          <Row label="tw — 벽두께">
            <NumInput value={sec.tw} min={100} step={10} onChange={v => setSec(s => ({ ...s, tw: v }))}/>
          </Row>
          <Row label="lw — 벽길이">
            <NumInput value={sec.lw} min={500} step={100} onChange={v => setSec(s => ({ ...s, lw: v }))}/>
          </Row>
          <Row label="hw — 벽높이">
            <NumInput value={sec.hw} min={500} step={100} onChange={v => setSec(s => ({ ...s, hw: v }))}/>
          </Row>
          <Row label="피복두께">
            <NumInput value={sec.cover} min={20} step={5} onChange={v => setSec(s => ({ ...s, cover: v }))}/>
          </Row>

          {/* 수직 철근 */}
          <GroupHeader title="Vertical Rebar" sub="수직근"/>
          <Row label="직경">
            <SelInput value={vbar.dia} options={rebarOptions}
              onChange={v => setVbar(r => ({ ...r, dia: v }))}/>
          </Row>
          <Row label="간격 sv (mm)">
            <NumInput value={vbar.spacing} min={100} step={25}
              onChange={v => setVbar(r => ({ ...r, spacing: v }))}/>
          </Row>
          <Row label="배근 겹수">
            <SelInput value={vbar.layers} options={layerOptions}
              onChange={v => setVbar(r => ({ ...r, layers: v as 1 | 2 }))}/>
          </Row>

          {/* 수평 철근 */}
          <GroupHeader title="Horizontal Rebar" sub="수평근"/>
          <Row label="직경">
            <SelInput value={hbar.dia} options={rebarOptions}
              onChange={v => setHbar(r => ({ ...r, dia: v }))}/>
          </Row>
          <Row label="간격 sh (mm)">
            <NumInput value={hbar.spacing} min={100} step={25}
              onChange={v => setHbar(r => ({ ...r, spacing: v }))}/>
          </Row>
          <Row label="배근 겹수">
            <SelInput value={hbar.layers} options={layerOptions}
              onChange={v => setHbar(r => ({ ...r, layers: v as 1 | 2 }))}/>
          </Row>

          {/* 하중 */}
          <GroupHeader title="Load Combination"/>
          <Row label="Pu (kN)">
            <NumInput value={load.Pu} min={0} step={50} onChange={v => setLoad(l => ({ ...l, Pu: v }))}/>
          </Row>
          <Row label="Vu (kN)">
            <NumInput value={load.Vu} min={0} step={50} onChange={v => setLoad(l => ({ ...l, Vu: v }))}/>
          </Row>
          <Row label="Mu (kN·m)">
            <NumInput value={load.Mu} min={0} step={50} onChange={v => setLoad(l => ({ ...l, Mu: v }))}/>
          </Row>

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
            {([
              ['tw × lw', `${sec.tw} × ${sec.lw} mm`],
              ['hw', `${sec.hw} mm`],
              ['ρv', `${rho_v.toFixed(4)}`],
              ['ρh', `${rho_h.toFixed(4)}`],
            ] as [string, string][]).map(([k, v]) => (
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
          <StatusBadge status={result.overallStatus}/>
        </div>

        {/* 단면도 SVG */}
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0.5rem 0.5rem 0.3rem',
          overflow: 'hidden',
          minHeight: 0,
          background: sec.tw > 0 && sec.lw > 0 ? undefined : 'var(--surface-2)',
        }}>
          {sec.tw > 0 && sec.lw > 0
            ? <WallSectionDiagram sec={sec} vbar={vbar} hbar={hbar} width={310} height={370}/>
            : <span style={{ fontSize: '0.75rem', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
                tw, lw 값을 입력하면 단면도가 표시됩니다
              </span>
          }
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
            {([
              ['fck', `${mat.fck} MPa`],
              ['fy',  `${mat.fy} MPa`],
              ['tw × lw', `${sec.tw}×${sec.lw}`],
              ['hw', `${sec.hw} mm`],
              ['수직근', `D${vbar.dia}@${vbar.spacing}×${vbar.layers}`],
              ['수평근', `D${hbar.dia}@${hbar.spacing}×${hbar.layers}`],
              ['ρv', `${rho_v.toFixed(4)}`],
              ['ρh', `${rho_h.toFixed(4)}`],
              ['Pu', `${load.Pu} kN`],
              ['Vu / Mu', `${load.Vu} / ${load.Mu}`],
            ] as [string, string][]).map(([k, v]) => (
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
          <StatusBadge status={result.overallStatus}/>
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
