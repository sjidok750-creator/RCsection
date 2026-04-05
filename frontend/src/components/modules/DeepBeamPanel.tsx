import { useState } from 'react'
import type { CheckItem } from '../../types'
import { useResponsive } from '../../hooks/useResponsive'
import ResultTable from '../common/ResultTable'

// ── 공용 UI ─────────────────────────────────────────────────
function Field({ label, value, unit, min = 0, step = 1, onChange }: {
  label: string; value: number; unit?: string; min?: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label>{label}{unit && <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: '0.25rem' }}>({unit})</span>}</label>
      <input type="number" value={value} min={min} step={step} onChange={e => onChange(Number(e.target.value))}/>
    </div>
  )
}
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', paddingBottom: '0.4rem', borderBottom: '1.5px solid var(--border-light)' }}>{title}</div>
      {children}
    </div>
  )
}

// ── 깊은보 계산 (KDS 14 20 24 : 2022, STM) ─────────────────
function calcDeepBeam(inp: {
  fck: number; fy: number; b: number; h: number
  Vu: number; ln: number; a: number
  Ash: number; sh: number; Asv: number; sv: number
}): CheckItem[] {
  const { fck, b, h, Vu, ln, a, Ash, sh, Asv, sv } = inp
  const d = 0.9 * h

  // 깊은보 조건
  const isDeep = ln / h < 4 || a / d <= 2

  // 최대 전단강도 (KDS 14 20 24)
  const Vn_max = 0.83 * Math.sqrt(fck) * b * d * 1e-3   // kN
  const phi_v  = 0.75
  const phi_Vn_max = phi_v * Vn_max
  const SF_max = phi_Vn_max / Vu

  // 스트럿 강도 (βs = 0.75, with 횡방향 철근)
  const betaS = 0.75
  const fce_s = 0.85 * betaS * fck   // MPa
  const theta = Math.atan(h / (2 * a))
  const Fns = fce_s * b * d * Math.cos(theta) * 1e-3   // kN (근사)
  const phi_Fns = phi_v * Fns
  const SF_strut = phi_Fns / Vu

  // 최소 수평·수직 철근비
  const rho_h = Ash / (b * sh)
  const rho_v = Asv / (b * sv)
  const rho_min = 0.0025
  const SF_rho_h = rho_h / rho_min
  const SF_rho_v = rho_v / rho_min

  return [
    {
      id: 'deep-condition', label: '① 깊은보 적용 조건',
      demandSymbol: 'ln/h', capacitySymbol: '4.0',
      demand: Math.round((ln / h) * 100) / 100, capacity: 4.0, unit: '',
      ratio: (ln / h) / 4.0, SF: 4.0 / (ln / h),
      status: isDeep ? 'OK' : 'NG',
      formula: `ln/h = ${ln}/${h} = ${(ln/h).toFixed(2)} < 4.0  또는  a/d = ${a}/${d.toFixed(0)} = ${(a/d).toFixed(2)} ≤ 2.0  → 깊은보 ${isDeep ? '적용 가능' : '적용 불가'}`,
      steps: [], detail: { 'ln/h': (ln / h).toFixed(2), 'a/d': (a / d).toFixed(2), 'd = 0.9h': `${d.toFixed(0)} mm`, '깊은보 조건': isDeep ? 'Yes' : 'No' },
    },
    {
      id: 'deep-vmax', label: '② 최대 전단강도',
      demandSymbol: 'Vu', capacitySymbol: 'φVn,max',
      demand: Vu, capacity: Math.round(phi_Vn_max * 10) / 10, unit: 'kN',
      ratio: Vu / phi_Vn_max, SF: SF_max,
      status: Vu <= phi_Vn_max ? 'OK' : 'NG',
      formula: `φVn,max = φ·0.83·√fck·b·d = ${phi_v}×0.83×√${fck}×${b}×${d.toFixed(0)}×10⁻³ = ${phi_Vn_max.toFixed(1)} kN  ≥  Vu = ${Vu} kN`,
      steps: [], detail: { 'φ': phi_v.toString(), 'Vn,max': `${Vn_max.toFixed(1)} kN`, 'φVn,max': `${phi_Vn_max.toFixed(1)} kN`, 'd = 0.9h': `${d.toFixed(0)} mm` },
    },
    {
      id: 'deep-strut', label: '③ 스트럿 강도 (STM)',
      demandSymbol: 'Vu', capacitySymbol: 'φFns',
      demand: Vu, capacity: Math.round(phi_Fns * 10) / 10, unit: 'kN',
      ratio: Vu / phi_Fns, SF: SF_strut,
      status: Vu <= phi_Fns ? 'OK' : 'NG',
      formula: `φFns = φ·fce,s·b·d·cosθ = ${phi_v}×${fce_s.toFixed(1)}×${b}×${d.toFixed(0)}×cos(${(theta*180/Math.PI).toFixed(1)}°)×10⁻³ = ${phi_Fns.toFixed(1)} kN  ≥  Vu = ${Vu} kN`,
      steps: [], detail: { 'βs': betaS.toString(), 'fce,s = 0.85·βs·fck': `${fce_s.toFixed(1)} MPa`, 'θ = atan(h/2a)': `${(theta*180/Math.PI).toFixed(1)}°`, 'Fns (근사)': `${Fns.toFixed(1)} kN` },
    },
    {
      id: 'deep-rho-h', label: '④ 수평 최소철근비',
      demandSymbol: 'ρh,min', capacitySymbol: 'ρh,prov',
      demand: rho_min, capacity: Math.round(rho_h * 100000) / 100000, unit: '',
      ratio: rho_min / (rho_h || 0.0001), SF: SF_rho_h,
      status: rho_h >= rho_min ? 'OK' : 'NG',
      formula: `ρh = Ash/(b·sh) = ${Ash}/(${b}×${sh}) = ${rho_h.toFixed(5)}  ≥  ρh,min = ${rho_min} (KDS 14 20 24)`,
      steps: [], detail: { 'Ash': `${Ash} mm²`, 'sh': `${sh} mm`, 'ρh': rho_h.toFixed(5), 'ρh,min': rho_min.toString() },
    },
    {
      id: 'deep-rho-v', label: '⑤ 수직 최소철근비',
      demandSymbol: 'ρv,min', capacitySymbol: 'ρv,prov',
      demand: rho_min, capacity: Math.round(rho_v * 100000) / 100000, unit: '',
      ratio: rho_min / (rho_v || 0.0001), SF: SF_rho_v,
      status: rho_v >= rho_min ? 'OK' : 'NG',
      formula: `ρv = Asv/(b·sv) = ${Asv}/(${b}×${sv}) = ${rho_v.toFixed(5)}  ≥  ρv,min = ${rho_min} (KDS 14 20 24)`,
      steps: [], detail: { 'Asv': `${Asv} mm²`, 'sv': `${sv} mm`, 'ρv': rho_v.toFixed(5), 'ρv,min': rho_min.toString() },
    },
  ]
}

// ── 깊은보 단면도 SVG ───────────────────────────────────────
function DeepBeamDiagram({ b, h }: { b: number; h: number }) {
  const W = 280; const H = 280
  const pad = 36
  const scaleX = (W - pad * 2) / b
  const scaleY = (H - pad * 2) / h
  const sc = Math.min(scaleX, scaleY)
  const dw = b * sc; const dh = h * sc
  const ox = (W - dw) / 2; const oy = (H - dh) / 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#f8fafc" rx="10"/>
      <defs>
        <pattern id="hatch2" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#d1d9e6" strokeWidth="5"/>
        </pattern>
      </defs>
      <rect x={ox} y={oy} width={dw} height={dh} fill="url(#hatch2)" stroke="#94a3b8" strokeWidth="1.5" rx="2"/>
      <rect x={ox} y={oy} width={dw} height={dh} fill="rgba(226,232,240,0.55)" rx="2"/>
      {/* 수평 철근 표시 */}
      {[0.2, 0.4, 0.6, 0.8].map(r => (
        <line key={r} x1={ox + 8} y1={oy + dh * r} x2={ox + dw - 8} y2={oy + dh * r}
          stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round"/>
      ))}
      {/* 수직 철근 표시 */}
      {[0.25, 0.5, 0.75].map(r => (
        <line key={r} x1={ox + dw * r} y1={oy + 8} x2={ox + dw * r} y2={oy + dh - 8}
          stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
      ))}
      {/* 치수 */}
      <text x={ox + dw / 2} y={oy + dh + 18} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono, monospace">b = {b} mm</text>
      <text x={ox - 14} y={oy + dh / 2} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono, monospace" transform={`rotate(-90,${ox - 14},${oy + dh / 2})`}>h = {h} mm</text>
      {/* 범례 */}
      <line x1={ox} y1={oy - 14} x2={ox + 20} y2={oy - 14} stroke="#16a34a" strokeWidth="2.5"/>
      <text x={ox + 24} y={oy - 10} fill="#475569" fontSize="10" fontFamily="inherit">수평근</text>
      <line x1={ox + 80} y1={oy - 14} x2={ox + 100} y2={oy - 14} stroke="#3b82f6" strokeWidth="2.5"/>
      <text x={ox + 104} y={oy - 10} fill="#475569" fontSize="10" fontFamily="inherit">수직근</text>
    </svg>
  )
}

export default function DeepBeamPanel() {
  const { isCompact } = useResponsive()
  const [fck, setFck] = useState(27); const [fy, setFy] = useState(400)
  const [b, setB] = useState(400); const [h, setH] = useState(1200)
  const [Vu, setVu] = useState(800); const [ln, setLn] = useState(3600); const [a, setA] = useState(800)
  const [Ash, setAsh] = useState(506.7); const [sh, setSh] = useState(200)
  const [Asv, setAsv] = useState(506.7); const [sv, setSv] = useState(200)

  const items = calcDeepBeam({ fck, fy, b, h, Vu, ln, a, Ash, sh, Asv, sv })
  const hasNG = items.some(i => i.status === 'NG')
  const overall = hasNG ? 'NG' : 'OK'
  const overallColor = hasNG ? 'var(--danger)' : 'var(--success)'

  return (
    <div style={{ display: 'flex', flexDirection: isCompact ? 'column' : 'row', flex: 1, height: '100%', overflow: isCompact ? 'auto' : 'hidden' }}>
      {/* 단면도 */}
      <div style={{ width: isCompact ? '100%' : 'clamp(210px, 32%, 340px)', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: isCompact ? 'none' : '1.5px solid var(--border)', borderBottom: isCompact ? '1.5px solid var(--border)' : 'none', background: 'var(--surface)' }}>
        <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>단 면 도</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: overallColor, background: hasNG ? '#fef2f2' : '#f0fdf4', borderRadius: '6px', padding: '0.18rem 0.6rem', fontFamily: 'var(--font-mono)', border: `1px solid ${overallColor}44` }}>{overall}</span>
        </div>
        <div style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <DeepBeamDiagram b={b} h={h}/>
        </div>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border-light)', background: 'var(--surface-2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
          {[['b×h', `${b}×${h}`], ['ln/h', (ln/h).toFixed(2)], ['a/d', (a/(0.9*h)).toFixed(2)], ['Vu', `${Vu} kN`]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{k}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 입력 + 결과 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
          <SectionCard title="재료">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <Field label="fck" value={fck} unit="MPa" min={21} step={3} onChange={setFck}/>
              <Field label="fy"  value={fy}  unit="MPa" min={300} step={50} onChange={setFy}/>
            </div>
          </SectionCard>
          <SectionCard title="단면">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <Field label="b (폭)"  value={b}  unit="mm" min={100} step={50} onChange={setB}/>
              <Field label="h (높이)" value={h} unit="mm" min={200} step={100} onChange={setH}/>
              <Field label="ln (순경간)" value={ln} unit="mm" min={100} step={100} onChange={setLn}/>
              <Field label="a (전단경간)" value={a} unit="mm" min={100} step={50} onChange={setA}/>
            </div>
          </SectionCard>
          <SectionCard title="수평철근 (Ash / sh)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <Field label="Ash (면적)" value={Ash} unit="mm²" min={0} step={50} onChange={setAsh}/>
              <Field label="sh (간격)"  value={sh}  unit="mm"  min={50} step={25} onChange={setSh}/>
            </div>
          </SectionCard>
          <SectionCard title="수직철근 (Asv / sv)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <Field label="Asv (면적)" value={Asv} unit="mm²" min={0} step={50} onChange={setAsv}/>
              <Field label="sv (간격)"  value={sv}  unit="mm"  min={50} step={25} onChange={setSv}/>
            </div>
          </SectionCard>
          <SectionCard title="설계 하중">
            <Field label="Vu (계수 전단력)" value={Vu} unit="kN" min={0} step={10} onChange={setVu}/>
          </SectionCard>
          <SectionCard title="검토 결과">
            <ResultTable items={items} overallStatus={hasNG ? 'NG' : 'OK'}/>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
