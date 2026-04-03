import { useState, useCallback } from 'react'
import type { MaterialInput, SectionInput, ReinforcementInput, LoadInput, CheckResult, CheckItem, CalcLine } from '../../types'
import SimpleBeamDiagram, { REBAR_AREA } from '../diagrams/SimpleBeamDiagram'
import ResultTable from '../common/ResultTable'

// ── 기본값 ──────────────────────────────────────────────────
const DEFAULT_MAT: MaterialInput  = { fck: 27, fy: 400, Es: 200000 }
const DEFAULT_SEC: SectionInput   = { b: 0, h: 0, d: 0, cover: 0 }
const DEFAULT_REB: ReinforcementInput = {
  tension: [{ count: 0, dia: 22, row: 1, inputMode: 'count', spacing: 0 }],
  compression: [],
  stirrup_dia: 10,
  stirrup_spacing: 0,
  stirrup_legs: 2,
}
const DEFAULT_LOAD: LoadInput = { Mu: 0, Vu: 0, Nu: 0, span: 0, wD: 0, wL: 0 }

// ── KDS 14 20 20/22/30 : 2022 계산 엔진 ─────────────────────
function calcSimpleBeam(mat: MaterialInput, sec: SectionInput, reb: ReinforcementInput, load: LoadInput): CheckResult {
  const { fck, fy, Es } = mat
  const { b, d, h, cover } = sec
  const { stirrup_dia, stirrup_spacing, stirrup_legs } = reb

  // 간격모드이면 count = floor(b / spacing), 개수모드이면 count 직접 사용
  const resolveCount = (l: typeof reb.tension[0]) => {
    if (l.inputMode === 'spacing' && (l.spacing ?? 0) > 0)
      return Math.floor(b / (l.spacing!))
    return l.count
  }
  const As  = reb.tension.reduce((s, l) => s + resolveCount(l) * (REBAR_AREA[l.dia] ?? 0), 0)
  const Av  = stirrup_legs * (REBAR_AREA[stirrup_dia] ?? 0)   // 다리수 × 1본 단면적

  const beta1 = fck <= 28 ? 0.85 : Math.max(0.85 - 0.007 * (fck - 28), 0.65)
  const a  = (As * fy) / (0.85 * fck * b)
  const c  = a / beta1
  const ey = fy / Es
  const et = 0.003 * (d - c) / c

  let phi_f: number
  if (et >= 0.005)     phi_f = 0.85
  else if (et <= ey)   phi_f = 0.65
  else                 phi_f = 0.65 + 0.2 * (et - ey) / (0.005 - ey)

  const Mn     = (As * fy * (d - a / 2)) * 1e-6
  const phi_Mn = phi_f * Mn
  const SF_f   = phi_Mn / load.Mu

  const rho     = As / (b * d)
  const rho_min = Math.max(0.25 * Math.sqrt(fck) / fy, 1.4 / fy)
  const rho_bal = (0.85 * beta1 * fck / fy) * (0.003 / (0.003 + ey))
  const rho_max = 0.75 * rho_bal

  const lambda   = 1.0
  const lambda_s = Math.min(Math.sqrt(2 / (1 + 0.004 * d)), 1.0)
  const rho_w    = As / (b * d)
  const Vc_det   = 0.66 * lambda_s * lambda * Math.pow(rho_w, 1/3) * Math.pow(fck, 1/3) * b * d * 1e-3
  const Vc_min   = 0.17 * lambda * Math.sqrt(fck) * b * d * 1e-3
  const Vc       = Math.max(Vc_det, Vc_min)
  const phi_v    = 0.75
  const Vs       = stirrup_spacing > 0 ? (Av * fy * d / stirrup_spacing) * 1e-3 : 0
  const phi_Vn   = phi_v * (Vc + Vs)
  const SF_v     = phi_Vn / load.Vu

  const needMinStirrup = load.Vu > 0.5 * phi_v * Vc
  const Av_min_s = Math.max(0.0625 * Math.sqrt(fck) * b / fy, 0.35 * b / fy)
  const Av_prov_s = Av / stirrup_spacing
  const SF_stirrup = Av_prov_s / Av_min_s

  const Ec   = 8500 * Math.pow(fck + 4, 1/3)
  const n    = Math.round(Es / Ec)
  const A_coef = b / 2
  const B_coef = n * As
  const C_coef = -n * As * d
  const kd = (-B_coef + Math.sqrt(B_coef * B_coef - 4 * A_coef * C_coef)) / (2 * A_coef)
  const Icr = (b * Math.pow(kd, 3)) / 3 + n * As * Math.pow(d - kd, 2)
  const Ma = (load.wD + load.wL) * Math.pow(load.span / 1000, 2) / 8
  const fs = (Ma * 1e6) * (d - kd) * n / Icr
  const fs_allow = 0.6 * fy
  const SF_crack_stress = fs_allow / fs

  const dc = cover + stirrup_dia + (reb.tension[0]?.dia ?? 22) / 2
  const betaS = (h - kd) / (d - kd)
  const es = fs / Es
  const wk = 0.011 * betaS * es * Math.pow(dc, 1/3) * 1000
  const wk_allow = 0.3
  const wk_mm    = wk / 1000
  const SF_crack = wk_allow / wk_mm

  const Av_bar = REBAR_AREA[stirrup_dia] ?? 0

  // 헬퍼: CalcLine 생성 단축 함수 (변수명 충돌 방지: sec → csec)
  const csec = (text: string): CalcLine => ({ type: 'section', text })
  const eq   = (text: string, value?: string, indent = 0): CalcLine => ({ type: 'eq', text, value, indent })
  const eqk  = (text: string, value?: string, indent = 0): CalcLine => ({ type: 'eq-key', text, value, indent })
  const res  = (text: string, value?: string): CalcLine => ({ type: 'result', text, value })
  const verd = (text: string, ok: boolean): CalcLine => ({ type: 'verdict', text, value: ok ? 'O.K' : 'N.G' })
  const note = (text: string): CalcLine => ({ type: 'note', text })

  const items: CheckItem[] = [

    // ════════════════════════════════════════════════════════
    // ① 휨 강도  (KDS 14 20 20 : 2022)
    // ════════════════════════════════════════════════════════
    {
      id: 'flexure', label: '① 휨 강도',
      demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: load.Mu, capacity: phi_Mn, unit: 'kN·m',
      ratio: load.Mu / phi_Mn, SF: SF_f,
      status: load.Mu <= phi_Mn ? 'OK' : 'NG',
      formula: `Mu = ${load.Mu} kN·m   φMn = ${phi_Mn.toFixed(2)} kN·m   S.F = ${SF_f.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 인장철근 단면적'),
        eq(`As = n × Ab`, `${reb.tension[0]?.count} × ${REBAR_AREA[reb.tension[0]?.dia ?? 22]} mm²`),
        eqk(`As`, `${Math.round(As)} mm²`),

        csec('2. 등가직사각형 응력블록 깊이  (KDS 14 20 20)'),
        note('β₁ : fck ≤ 28 MPa → 0.85,  초과 시 0.007/MPa 감소, min 0.65'),
        eq(`β₁`, `${beta1.toFixed(3)}  (fck = ${fck} MPa)`),
        eq(`a = As·fy / (0.85·fck·b)`, `${Math.round(As)} × ${fy} / (0.85 × ${fck} × ${b})`),
        eqk(`a`, `${a.toFixed(2)} mm`),
        eq(`c = a / β₁`, `${a.toFixed(2)} / ${beta1.toFixed(3)}`),
        eqk(`c`, `${c.toFixed(2)} mm`),

        csec('3. 인장철근 변형률'),
        note('평면유지 가정 (Plane sections remain plane)'),
        eq(`εt = 0.003 × (d − c) / c`, `0.003 × (${d} − ${c.toFixed(1)}) / ${c.toFixed(1)}`),
        eqk(`εt`, `${et.toFixed(5)}`),

        csec('4. 강도감소계수 φ  (KDS 14 20 01)'),
        note('εt ≥ 0.005 → 인장지배 φ=0.85 / εt ≤ εy → 압축지배 φ=0.65 / 전이구간 선형보간'),
        eq(`εy = fy / Es`, `${fy} / ${Es} = ${ey.toFixed(5)}`),
        eqk(
          et >= 0.005
            ? `εt = ${et.toFixed(5)} ≥ 0.005  →  인장지배`
            : et <= ey
            ? `εt = ${et.toFixed(5)} ≤ εy  →  압축지배`
            : `εt = ${et.toFixed(5)}  전이구간 (선형보간)`,
          `φ = ${phi_f.toFixed(4)}`
        ),

        csec('5. 공칭 휨강도 Mn'),
        eq(`Mn = As·fy·(d − a/2) × 10⁻⁶`, `${Math.round(As)} × ${fy} × (${d} − ${(a/2).toFixed(1)}) × 10⁻⁶`),
        eqk(`Mn`, `${Mn.toFixed(4)} kN·m`),

        csec('6. 설계 휨강도 φMn'),
        eq(`φMn = φ × Mn`, `${phi_f.toFixed(4)} × ${Mn.toFixed(4)}`),
        eqk(`φMn`, `${phi_Mn.toFixed(4)} kN·m`),

        csec('7. 검토'),
        res(`Mu = ${load.Mu} kN·m`, `φMn = ${phi_Mn.toFixed(2)} kN·m`),
        verd(`Mu ${load.Mu <= phi_Mn ? '≤' : '>'} φMn  →  S.F = ${SF_f.toFixed(3)}`, load.Mu <= phi_Mn),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ② 철근비 검토  (KDS 14 20 20 : 2022  8.3절)
    // ════════════════════════════════════════════════════════
    {
      id: 'rho', label: '② 철근비 검토',
      demandSymbol: 'ρ', capacitySymbol: 'ρmax',
      demand: rho, capacity: rho_max, unit: '',
      ratio: rho < rho_min ? 0.001 : rho / rho_max,
      SF: rho < rho_min ? 0 : rho_max / rho,
      status: rho < rho_min ? 'NG' : rho > rho_max ? 'NG' : 'OK',
      formula: `ρmin = ${rho_min.toFixed(5)}   ρ = ${rho.toFixed(5)}   ρmax = ${rho_max.toFixed(5)}`,
      detail: {},
      steps: [
        csec('1. 실제 철근비'),
        eq(`ρ = As / (b·d)`, `${Math.round(As)} / (${b} × ${d})`),
        eqk(`ρ`, `${rho.toFixed(5)}`),

        csec('2. 최소 철근비  (KDS 14 20 20  식 8.3-1)'),
        note('ρmin = max( 0.25√fck/fy ,  1.4/fy )'),
        eq(`0.25√fck / fy`, `0.25 × √${fck} / ${fy} = ${(0.25*Math.sqrt(fck)/fy).toFixed(6)}`),
        eq(`1.4 / fy`, `1.4 / ${fy} = ${(1.4/fy).toFixed(6)}`),
        eqk(`ρmin = max(…)`, `${rho_min.toFixed(6)}`),

        csec('3. 균형 철근비 & 최대 철근비'),
        note('균형파괴: 콘크리트 극단압축섬유 εcu=0.003 동시에 철근 항복'),
        eq(`ρbal = 0.85·β₁·fck/fy × 0.003/(0.003+εy)`,
           `0.85 × ${beta1.toFixed(3)} × ${fck}/${fy} × 0.003/(0.003+${ey.toFixed(5)})`),
        eqk(`ρbal`, `${rho_bal.toFixed(6)}`),
        eq(`ρmax = 0.75·ρbal`, `0.75 × ${rho_bal.toFixed(6)}`),
        eqk(`ρmax`, `${rho_max.toFixed(6)}`),

        csec('4. 검토'),
        res(`ρmin = ${rho_min.toFixed(5)}`, `ρmax = ${rho_max.toFixed(5)}`),
        verd(
          rho < rho_min
            ? `ρ = ${rho.toFixed(5)} < ρmin  →  최소철근비 미달`
            : rho > rho_max
            ? `ρ = ${rho.toFixed(5)} > ρmax  →  최대철근비 초과`
            : `ρmin ≤ ρ = ${rho.toFixed(5)} ≤ ρmax`,
          !(rho < rho_min || rho > rho_max)
        ),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ③ 전단 강도  (KDS 14 20 22 : 2022)
    // ════════════════════════════════════════════════════════
    {
      id: 'shear', label: '③ 전단 강도',
      demandSymbol: 'Vu', capacitySymbol: 'φVn',
      demand: load.Vu, capacity: phi_Vn, unit: 'kN',
      ratio: load.Vu / phi_Vn, SF: SF_v,
      status: load.Vu <= phi_Vn ? 'OK' : 'NG',
      formula: `Vu = ${load.Vu} kN   φVn = ${phi_Vn.toFixed(2)} kN   S.F = ${SF_v.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 전단철근 단면적'),
        note('Av : 전단철근 1조의 단면적 = 다리수(n_legs) × 1본 단면적(Ab)'),
        eq(`Ab (D${stirrup_dia} 1본)`, `${Av_bar} mm²`),
        eq(`Av = n_legs × Ab`, `${stirrup_legs} × ${Av_bar}`),
        eqk(`Av`, `${Math.round(Av)} mm²`),

        csec('2. 콘크리트 전단강도 Vc  (KDS 14 20 22  식 7.2-2)'),
        note('Vc = 0.66·λs·λ·(ρw)^(1/3)·(fck)^(1/3)·bw·d  [단위: N → ×10⁻³ kN]'),
        eq(`크기효과계수 λs = min(√(2/(1+0.004d)), 1.0)`,
           `min(√(2/(1+0.004×${d})), 1.0) = ${lambda_s.toFixed(4)}`),
        eq(`경량콘크리트계수 λ`, `1.0  (보통콘크리트)`),
        eq(`ρw = As/(bw·d)`, `${Math.round(As)}/(${b}×${d}) = ${rho_w.toFixed(5)}`),
        eq(`Vc (상세식)`,
           `0.66×${lambda_s.toFixed(4)}×1.0×${rho_w.toFixed(5)}^(1/3)×${fck}^(1/3)×${b}×${d}×10⁻³`),
        eq(`Vc (상세식 계산값)`, `${Vc_det.toFixed(3)} kN`),
        eq(`Vc (최소식) = 0.17·λ·√fck·bw·d×10⁻³`,
           `0.17×1.0×√${fck}×${b}×${d}×10⁻³ = ${Vc_min.toFixed(3)} kN`),
        eqk(`Vc = max(상세식, 최소식)`, `max(${Vc_det.toFixed(3)}, ${Vc_min.toFixed(3)}) = ${Vc.toFixed(3)} kN`),

        csec('3. 전단철근 강도 Vs'),
        note('Vs = Av·fy·d / s  (수직 스터럽)'),
        eq(`Vs = Av·fy·d / s`,
           `${Math.round(Av)}×${fy}×${d}/${stirrup_spacing}×10⁻³`),
        eqk(`Vs`, `${Vs.toFixed(3)} kN`),

        csec('4. 설계 전단강도 φVn'),
        eq(`φ = ${phi_v}  (전단, KDS 14 20 01)`),
        eq(`φVn = φ·(Vc + Vs)`, `${phi_v}×(${Vc.toFixed(3)}+${Vs.toFixed(3)})`),
        eqk(`φVn`, `${phi_Vn.toFixed(4)} kN`),

        csec('5. 검토'),
        res(`Vu = ${load.Vu} kN`, `φVn = ${phi_Vn.toFixed(2)} kN`),
        verd(`Vu ${load.Vu <= phi_Vn ? '≤' : '>'} φVn  →  S.F = ${SF_v.toFixed(3)}`, load.Vu <= phi_Vn),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ④ 최소 전단철근  (KDS 14 20 22 : 2022  7.3절)
    // ════════════════════════════════════════════════════════
    {
      id: 'stirrup', label: '④ 최소 전단철근',
      demandSymbol: 'Av,min/s', capacitySymbol: 'Av,prov/s',
      demand: Av_min_s, capacity: Av_prov_s, unit: 'mm²/mm',
      ratio: needMinStirrup ? Av_prov_s / Av_min_s : 1,
      SF: SF_stirrup,
      status: !needMinStirrup ? 'OK' : Av_prov_s >= Av_min_s ? 'OK' : 'NG',
      formula: needMinStirrup
        ? `Av,prov/s = ${Av_prov_s.toFixed(4)} mm²/mm   Av,min/s = ${Av_min_s.toFixed(4)} mm²/mm`
        : `Vu = ${load.Vu} kN ≤ 0.5φVc = ${(0.5*phi_v*Vc).toFixed(2)} kN  →  최소전단철근 불필요`,
      detail: {},
      steps: [
        csec('1. 최소 전단철근 필요 여부  (KDS 14 20 22  7.3.1)'),
        note('Vu > 0.5·φ·Vc 이면 최소 전단철근 배치 필요'),
        eq(`0.5·φ·Vc`, `0.5 × ${phi_v} × ${Vc.toFixed(3)} = ${(0.5*phi_v*Vc).toFixed(3)} kN`),
        eqk(
          `Vu = ${load.Vu} kN  ${needMinStirrup ? '>' : '≤'}  0.5φVc = ${(0.5*phi_v*Vc).toFixed(2)} kN`,
          needMinStirrup ? '최소전단철근 필요' : '배치 불필요'
        ),

        ...(needMinStirrup ? [
        csec('2. 최소 전단철근량  (KDS 14 20 22  식 7.3-1)'),
          note('Av,min/s = max( 0.0625·√fck·bw/fy ,  0.35·bw/fy )'),
          eq(`0.0625·√fck·bw/fy`,
             `0.0625 × √${fck} × ${b} / ${fy} = ${(0.0625*Math.sqrt(fck)*b/fy).toFixed(5)} mm²/mm`),
          eq(`0.35·bw/fy`,
             `0.35 × ${b} / ${fy} = ${(0.35*b/fy).toFixed(5)} mm²/mm`),
          eqk(`Av,min/s = max(…)`, `${Av_min_s.toFixed(5)} mm²/mm`),

        csec('3. 제공 전단철근'),
          eq(`Av,prov/s = Av / s`, `${Math.round(Av)} / ${stirrup_spacing}`),
          eqk(`Av,prov/s`, `${Av_prov_s.toFixed(5)} mm²/mm`),

        csec('4. 검토'),
          res(`Av,min/s = ${Av_min_s.toFixed(4)} mm²/mm`, `Av,prov/s = ${Av_prov_s.toFixed(4)} mm²/mm`),
          verd(
            `Av,prov/s ${Av_prov_s >= Av_min_s ? '≥' : '<'} Av,min/s`,
            Av_prov_s >= Av_min_s
          ),
        ] : [
          note('Vu ≤ 0.5φVc → 최소 전단철근 배치 불필요  (O.K)'),
        ]),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ⑤ 사용성 — 균열단면 철근응력  (KDS 14 20 30 : 2022)
    // ════════════════════════════════════════════════════════
    {
      id: 'crack-stress', label: '⑤ 철근응력 검토 (사용성)',
      demandSymbol: 'fs', capacitySymbol: '0.6fy',
      demand: Math.round(fs * 10) / 10, capacity: fs_allow, unit: 'MPa',
      ratio: fs / fs_allow, SF: SF_crack_stress,
      status: fs <= fs_allow ? 'OK' : 'NG',
      formula: `fs = ${fs.toFixed(1)} MPa   0.6fy = ${fs_allow.toFixed(0)} MPa   S.F = ${SF_crack_stress.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 재료 탄성계수'),
        note('KDS: Ec = 8,500·(fck+4)^(1/3)  MPa'),
        eq(`Ec = 8500·(fck+4)^(1/3)`, `8500 × (${fck}+4)^(1/3) = ${Math.round(Ec)} MPa`),
        eq(`Es`, `${Es.toLocaleString()} MPa`),
        eqk(`탄성계수비 n = Es/Ec`, `${mat.Es} / ${Math.round(Ec)} ≈ ${n}  (정수 반올림)`),

        csec('2. 균열단면 중립축 kd  (탄성이론)'),
        note('균열발생 후 인장콘크리트 무시,  압축측만 유효 (환산단면법)'),
        note('2차방정식:  (b/2)·kd² − n·As·(d−kd) = 0'),
        eq(`(b/2)·kd² + n·As·kd − n·As·d = 0`,
           `(${b}/2)·kd² + ${n}×${Math.round(As)}·kd − ${n}×${Math.round(As)}×${d} = 0`),
        eqk(`kd (양의 근)`, `${kd.toFixed(3)} mm`),

        csec('3. 균열단면 2차모멘트 Icr'),
        note('Icr = b·kd³/3 + n·As·(d−kd)²'),
        eq(`b·kd³/3`, `${b} × ${kd.toFixed(1)}³ / 3 = ${(b*Math.pow(kd,3)/3/1e6).toFixed(4)} ×10⁶ mm⁴`),
        eq(`n·As·(d−kd)²`, `${n} × ${Math.round(As)} × (${d}−${kd.toFixed(1)})² = ${(n*As*Math.pow(d-kd,2)/1e6).toFixed(4)} ×10⁶ mm⁴`),
        eqk(`Icr`, `${(Icr/1e6).toFixed(4)} × 10⁶ mm⁴`),

        csec('4. 사용하중 휨모멘트 Ma'),
        note('계수하중이 아닌 사용하중 적용 (wD, wL 무계수)'),
        eq(`Ma = (wD + wL)·L² / 8`,
           `(${load.wD} + ${load.wL}) × ${(load.span/1000).toFixed(1)}² / 8`),
        eqk(`Ma`, `${Ma.toFixed(4)} kN·m`),

        csec('5. 인장철근 응력 fs'),
        note('fs = Ma·(d−kd)·n / Icr  (환산단면 탄성해석)'),
        eq(`fs = Ma × n × (d−kd) / Icr`,
           `${Ma.toFixed(4)}×10⁶ × ${n} × (${d}−${kd.toFixed(1)}) / (${(Icr/1e6).toFixed(4)}×10⁶)`),
        eqk(`fs`, `${fs.toFixed(3)} MPa`),

        csec('6. 허용 철근응력'),
        eq(`0.6·fy`, `0.6 × ${fy} = ${fs_allow.toFixed(0)} MPa`),

        csec('7. 검토'),
        res(`fs = ${fs.toFixed(1)} MPa`, `0.6fy = ${fs_allow.toFixed(0)} MPa`),
        verd(`fs ${fs <= fs_allow ? '≤' : '>'} 0.6fy  →  S.F = ${SF_crack_stress.toFixed(3)}`, fs <= fs_allow),
      ],
    },

    // ════════════════════════════════════════════════════════
    // ⑥ 사용성 — 균열폭  (KDS 14 20 30 : 2022)
    // ════════════════════════════════════════════════════════
    {
      id: 'crack-width', label: '⑥ 균열폭 검토',
      demandSymbol: 'wk', capacitySymbol: 'wk,allow',
      demand: Math.round(wk_mm * 10000) / 10000,
      capacity: wk_allow, unit: 'mm',
      ratio: wk_mm / wk_allow, SF: SF_crack,
      status: wk_mm <= wk_allow ? 'OK' : 'NG',
      formula: `wk = ${wk_mm.toFixed(4)} mm   wk,allow = ${wk_allow} mm   S.F = ${SF_crack.toFixed(3)}`,
      detail: {},
      steps: [
        csec('1. 피복깊이 dc  (최외단 인장철근 중심까지)'),
        note('dc = 피복두께 + 스터럽 직경 + 인장주근 반경'),
        eq(`dc = cover + ds + dt/2`,
           `${cover} + ${stirrup_dia} + ${((reb.tension[0]?.dia??22)/2).toFixed(0)}`),
        eqk(`dc`, `${dc.toFixed(1)} mm`),

        csec('2. 변형률 분포계수 βs'),
        note('βs = (h − kd) / (d − kd)  : 중립축~단면하단 / 중립축~철근 비율'),
        eq(`βs = (h − kd) / (d − kd)`,
           `(${h} − ${kd.toFixed(1)}) / (${d} − ${kd.toFixed(1)})`),
        eqk(`βs`, `${betaS.toFixed(5)}`),

        csec('3. 철근 변형률 εs'),
        eq(`εs = fs / Es`, `${fs.toFixed(3)} / ${Es}`),
        eqk(`εs`, `${es.toExponential(5)}`),

        csec('4. 균열폭 wk  (KDS 14 20 30, Frosch 기반 간략식)'),
        note('wk = 0.011 · βs · εs · dc^(1/3)  [mm]'),
        eq(`wk = 0.011 × βs × εs × dc^(1/3)`,
           `0.011 × ${betaS.toFixed(5)} × ${es.toExponential(4)} × ${dc.toFixed(1)}^(1/3)`),
        eqk(`wk`, `${wk_mm.toFixed(5)} mm`),

        csec('5. 허용 균열폭  (KDS 14 20 30  표 4.2-1)'),
        eq(`wk,allow (일반환경)`, `0.3 mm`),
        note('부식환경 노출 시 0.2 mm 적용 — 별도 검토 필요'),

        csec('6. 검토'),
        res(`wk = ${wk_mm.toFixed(4)} mm`, `wk,allow = ${wk_allow} mm`),
        verd(`wk ${wk_mm <= wk_allow ? '≤' : '>'} wk,allow  →  S.F = ${SF_crack.toFixed(3)}`, wk_mm <= wk_allow),
      ],
    },
  ]

  const hasNG   = items.some(i => i.status === 'NG')
  const maxRatio = Math.max(...items.map(i => i.ratio))

  return {
    moduleId: 'simple-beam', items,
    overallStatus: hasNG ? 'NG' : maxRatio > 0.9 ? 'WARN' : 'OK',
    maxRatio,
    warnings: [
      ...(et < 0.004 ? ['인장지배 변형률 미달 (εt < 0.004) — 연성 확보 검토 필요'] : []),
      ...(wk_mm > wk_allow * 0.85 ? [`균열폭 허용치 근접 (wk = ${wk_mm.toFixed(3)} mm)`] : []),
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

// ── 메인 패널 ───────────────────────────────────────────────
export default function SimpleBeamPanel() {
  const [mat, setMat]   = useState<MaterialInput>(DEFAULT_MAT)
  const [sec, setSec]   = useState<SectionInput>(DEFAULT_SEC)
  const [reb, setReb]   = useState<ReinforcementInput>(DEFAULT_REB)
  const [load, setLoad] = useState<LoadInput>(DEFAULT_LOAD)

  // d 자동계산 (KDS 기준)
  // cover = 콘크리트 외면 ~ 스터럽 외면
  // d = h - cover - stirrup_dia - tension_bar_dia/2
  const autod = useCallback(() => {
    if (sec.h <= 0 || sec.cover <= 0) return 0
    const tDia = reb.tension[0]?.dia ?? 22
    return Math.max(0, sec.h - sec.cover - reb.stirrup_dia - tDia / 2)
  }, [sec.h, sec.cover, reb.stirrup_dia, reb.tension])

  const secD = { ...sec, d: autod() }
  const result = calcSimpleBeam(mat, secD, reb, load)
  const As = reb.tension.reduce((s, l) => {
    const n = (l.inputMode === 'spacing' && (l.spacing ?? 0) > 0)
      ? Math.floor(sec.b / l.spacing!)
      : l.count
    return s + n * (REBAR_AREA[l.dia] ?? 0)
  }, 0)

  const rebarOptions = [10,13,16,19,22,25,29,32,35].map(d => ({
    v: d, label: `D${d}  (${REBAR_AREA[d]} mm²)`
  }))
  const stirrupOptions = [10,13,16].map(d => ({ v: d, label: `D${d}` }))

  // 개수 → 간격: b / n  (단순 분할)
  const calcSpacingFromCount = (n: number): number => {
    if (n <= 0) return 0
    return Math.round(sec.b / n)
  }
  // 간격 → 개수: b / s  (단순 분할, 소수점 버림)
  const calcCountFromSpacing = (s: number): number => {
    if (s <= 0) return 0
    return Math.floor(sec.b / s)
  }

  const tLayer0    = reb.tension[0]
  const tInputMode = tLayer0?.inputMode ?? 'count'
  // 개수모드: spacing=0, 간격모드: count=0
  const tCount0    = tLayer0?.count ?? 4
  const tSpacing0  = tLayer0?.spacing ?? 0


  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>

      {/* ══ 좌측: 입력 패널 (트리형) ══ */}
      <div style={{
        width: 'clamp(240px, 26%, 320px)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border-dark)',
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
          }}>RC Beam Section Design</span>
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

          {/* 단면 */}
          <GroupHeader title="Section" sub="mm"/>
          <Row label="b — 폭">
            <NumInput value={sec.b} min={0} step={50} onChange={v => setSec(s => ({ ...s, b: v }))}/>
          </Row>
          <Row label="h — 전체높이">
            <NumInput value={sec.h} min={0} step={50} onChange={v => setSec(s => ({ ...s, h: v }))}/>
          </Row>
          <Row label="피복두께">
            <NumInput value={sec.cover} min={0} step={5} onChange={v => setSec(s => ({ ...s, cover: v }))}/>
          </Row>
          <Row label="d — 유효깊이">
            <div style={{ padding: '0.1rem 0.3rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                {secD.d > 0 ? secD.d : '—'}
              </span>
              <span style={{ fontSize: '0.63rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                mm (자동)
              </span>
            </div>
          </Row>

          {/* 철근 */}
          <GroupHeader title="Main Reinforcement" sub="인장철근"/>

          {/* 입력 모드 토글 */}
          <div style={{
            display: 'flex', gap: '0', margin: '0.2rem 0.4rem',
            border: '1px solid var(--border-dark)', borderRadius: '2px', overflow: 'hidden',
          }}>
            {(['count', 'spacing'] as const).map(mode => (
              <button key={mode}
                onClick={() => {
                  if (mode === 'spacing') {
                    // 개수 → 간격 전환: s = b / n
                    const n  = tLayer0?.count ?? 4
                    const sp = calcSpacingFromCount(n)
                    setReb(r => ({ ...r, tension: [{ ...r.tension[0], inputMode: 'spacing', spacing: sp, count: 0 }] }))
                  } else {
                    // 간격 → 개수 전환: n = b / s
                    const sp = tLayer0?.spacing ?? 250
                    const n  = calcCountFromSpacing(sp)
                    setReb(r => ({ ...r, tension: [{ ...r.tension[0], inputMode: 'count', count: n, spacing: 0 }] }))
                  }
                }}
                style={{
                  flex: 1, border: 'none', padding: '0.22rem 0',
                  fontSize: '0.66rem', fontWeight: 700,
                  fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  background: tInputMode === mode ? 'var(--primary)' : 'var(--surface-2)',
                  color: tInputMode === mode ? '#fff' : 'var(--text-3)',
                  letterSpacing: '0.04em',
                }}>
                {mode === 'count' ? '개수 입력' : '간격 입력'}
              </button>
            ))}
          </div>

          {/* 개수 행: 개수모드=입력, 간격모드=자동계산(0) */}
          <Row label="철근 개수 (개)">
            {tInputMode === 'count' ? (
              <NumInput value={tCount0} min={1}
                onChange={v => setReb(r => ({ ...r, tension: [{ ...r.tension[0], count: v, spacing: 0 }] }))}/>
            ) : (
              <div style={{ padding: '0.1rem 0.3rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {calcCountFromSpacing(tSpacing0)}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  개  (= {sec.b} / {tSpacing0})
                </span>
              </div>
            )}
          </Row>

          {/* 간격 행: 간격모드=입력, 개수모드=자동계산(0) */}
          <Row label="배근 간격 (mm)">
            {tInputMode === 'spacing' ? (
              <NumInput value={tSpacing0} min={50} step={25}
                onChange={v => setReb(r => ({ ...r, tension: [{ ...r.tension[0], spacing: v, count: 0 }] }))}/>
            ) : (
              <div style={{ padding: '0.1rem 0.3rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {calcSpacingFromCount(tCount0)}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  mm  (= {sec.b} / {tCount0})
                </span>
              </div>
            )}
          </Row>

          <Row label="철근 직경">
            <SelInput value={tLayer0?.dia ?? 22} options={rebarOptions}
              onChange={v => setReb(r => ({ ...r, tension: [{ ...r.tension[0], dia: v }] }))}/>
          </Row>

          <GroupHeader title="Shear Reinforcement" sub="스터럽"/>
          <Row label="스터럽 직경">
            <SelInput value={reb.stirrup_dia} options={stirrupOptions}
              onChange={v => setReb(r => ({ ...r, stirrup_dia: v }))}/>
          </Row>
          <Row label="다리수 (legs)">
            <SelInput value={reb.stirrup_legs}
              options={[2,3,4,5,6].map(n => ({ v: n, label: `${n}-leg  (Av = ${n}×${REBAR_AREA[reb.stirrup_dia]??0} mm²)` }))}
              onChange={v => setReb(r => ({ ...r, stirrup_legs: v }))}/>
          </Row>
          <Row label="간격 s (mm)">
            <NumInput value={reb.stirrup_spacing} min={50} step={25}
              onChange={v => setReb(r => ({ ...r, stirrup_spacing: v }))}/>
          </Row>

          {/* 하중 */}
          <GroupHeader title="Load Combination"/>
          <Row label="Mu (kN·m)">
            <NumInput value={load.Mu} min={0} step={5} onChange={v => setLoad(l => ({ ...l, Mu: v }))}/>
          </Row>
          <Row label="Vu (kN)">
            <NumInput value={load.Vu} min={0} step={5} onChange={v => setLoad(l => ({ ...l, Vu: v }))}/>
          </Row>
          <Row label="경간 L (m)">
            <NumInput value={load.span / 1000} min={0.5} step={0.5}
              onChange={v => setLoad(l => ({ ...l, span: v * 1000 }))}/>
          </Row>
          <Row label="wD (kN/m)">
            <NumInput value={load.wD} min={0} step={1} onChange={v => setLoad(l => ({ ...l, wD: v }))}/>
          </Row>
          <Row label="wL (kN/m)">
            <NumInput value={load.wL} min={0} step={1} onChange={v => setLoad(l => ({ ...l, wL: v }))}/>
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
              ['b × h', `${sec.b} × ${sec.h} mm`],
              ['d', `${secD.d} mm`],
              ['As', `${Math.round(As)} mm²`],
              ['피복', `${sec.cover} mm`],
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
        width: 'clamp(240px, 30%, 360px)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border-dark)',
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
          background: sec.b > 0 && sec.h > 0 ? undefined : 'var(--surface-2)',
        }}>
          {sec.b > 0 && sec.h > 0
            ? <SimpleBeamDiagram section={secD} rebar={reb} width={310} height={340}/>
            : <span style={{ fontSize: '0.75rem', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
                b, h 값을 입력하면 단면도가 표시됩니다
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
              ['b × h', `${sec.b}×${sec.h}`],
              ['d / d\'', `${secD.d} / ${sec.cover}`],
              ['인장철근',
                tInputMode === 'spacing'
                  ? `D${tLayer0?.dia}@${tSpacing0}→${calcCountFromSpacing(tSpacing0)}개`
                  : `${tCount0}-D${tLayer0?.dia}`
              ],
              ['As', `${Math.round(As)} mm²`],
              ['스터럽', `D${reb.stirrup_dia}@${reb.stirrup_spacing}-${reb.stirrup_legs}leg`],
              ['하중', `Mu=${load.Mu} / Vu=${load.Vu}`],
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

      {/* ══ 우측: 검토결과 (항상 표시) ══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>

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
    </div>
  )
}
