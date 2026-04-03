import { useState } from 'react'
import type { CheckItem } from '../../types'
import ResultTable from '../common/ResultTable'

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

// ── 코벨 계산 (KDS 14 20 24 : 2022) ────────────────────────
function calcCorbel(inp: {
  fck: number; fy: number; b: number; h: number; d: number
  Vu: number; Nuc: number; a: number
  Asc: number; Ah: number
}): CheckItem[] {
  const { fck, fy, b, h, d, Vu, Nuc, a, Asc, Ah } = inp

  // 코벨 조건
  const ad_ratio = a / d
  const corbel_ok = ad_ratio <= 1.0
  const Nuc_ok = Nuc <= Vu

  // 전단 마찰 (μ = 1.4, 일체타설)
  const mu    = 1.4
  const phi_v = 0.75
  const Vn_sf = Asc * fy * mu * 1e-3    // kN
  const Vn_max1 = 0.2 * fck * b * d * 1e-3
  const Vn_max2 = (3.3 + 0.08 * fck) * b * d * 1e-3
  const Vn_max3 = 11 * b * d * 1e-3
  const Vn_max = Math.min(Vn_max1, Vn_max2, Vn_max3)
  const Vn_shear = Math.min(Vn_sf, Vn_max)
  const phi_Vn = phi_v * Vn_shear
  const SF_shear = phi_Vn / Vu

  // 휨 + 직접 인장
  const Mf = Vu * a + Nuc * (h - d)    // kN·mm
  const Mf_knm = Mf / 1000             // kN·m
  const phi_f  = 0.9
  const Af = Mf_knm * 1e6 / (phi_f * fy * 0.85 * d)    // mm²
  const An = Nuc * 1e3 / (phi_f * fy)                    // mm²
  const Asc_req = Math.max(Asc, Af + An, 0.04 * (fck / fy) * b * d)
  const SF_flex = Asc / Asc_req

  // 수평 스터럽
  const Ah_req = 0.5 * (Asc_req - An)
  const SF_ah = Ah / (Ah_req || 1)

  return [
    {
      id: 'corbel-condition', label: '① 코벨 적용 조건',
      demandSymbol: 'a/d', capacitySymbol: '1.0',
      demand: Math.round(ad_ratio * 1000) / 1000, capacity: 1.0, unit: '',
      ratio: ad_ratio / 1.0, SF: 1.0 / ad_ratio,
      status: corbel_ok ? 'OK' : 'NG',
      formula: `a/d = ${a}/${d} = ${ad_ratio.toFixed(3)} ≤ 1.0 → 코벨 ${corbel_ok ? '적용 가능' : '적용 불가'}  |  Nuc/Vu = ${Nuc}/${Vu} = ${(Nuc/Vu).toFixed(3)} ${Nuc_ok ? '≤ 1.0 OK' : '> 1.0 NG'}`,
      steps: [], detail: { 'a': `${a} mm`, 'd': `${d} mm`, 'a/d': ad_ratio.toFixed(3), 'Nuc ≤ Vu': Nuc_ok ? 'OK' : 'NG' },
    },
    {
      id: 'corbel-shear', label: '② 전단 마찰 강도',
      demandSymbol: 'Vu', capacitySymbol: 'φVn',
      demand: Vu, capacity: Math.round(phi_Vn * 10) / 10, unit: 'kN',
      ratio: Vu / phi_Vn, SF: SF_shear,
      status: Vu <= phi_Vn ? 'OK' : 'NG',
      formula: `φVn = φ·min(Vn,sf, Vn,max) = ${phi_v}×min(${Vn_sf.toFixed(1)}, ${Vn_max.toFixed(1)}) = ${phi_Vn.toFixed(1)} kN  ≥  Vu = ${Vu} kN`,
      steps: [], detail: {
        'μ (일체타설)': mu.toString(),
        'Vn,sf = Asc·fy·μ': `${Vn_sf.toFixed(1)} kN`,
        'Vn,max = min(0.2fck·bd, ...)': `${Vn_max.toFixed(1)} kN`,
        'φVn': `${phi_Vn.toFixed(1)} kN`,
        'Asc': `${Math.round(Asc)} mm²`,
      },
    },
    {
      id: 'corbel-flex', label: '③ 주철근 Asc 검토',
      demandSymbol: 'Asc,req', capacitySymbol: 'Asc,prov',
      demand: Math.round(Asc_req), capacity: Math.round(Asc), unit: 'mm²',
      ratio: Asc_req / (Asc || 1), SF: SF_flex,
      status: Asc >= Asc_req ? 'OK' : 'NG',
      formula: `Asc,req = max(Af+An, 0.04·fck/fy·b·d) = max(${Math.round(Af)}+${Math.round(An)}, ${Math.round(0.04*(fck/fy)*b*d)}) = ${Math.round(Asc_req)} mm²  ≤  Asc,prov = ${Math.round(Asc)} mm²`,
      steps: [], detail: {
        'Mf = Vu·a + Nuc·(h-d)': `${Mf_knm.toFixed(2)} kN·m`,
        'Af (휨)': `${Math.round(Af)} mm²`,
        'An (직접인장)': `${Math.round(An)} mm²`,
        'Asc,req': `${Math.round(Asc_req)} mm²`,
        'Asc,prov': `${Math.round(Asc)} mm²`,
      },
    },
    {
      id: 'corbel-ah', label: '④ 수평 스터럽 Ah',
      demandSymbol: 'Ah,req', capacitySymbol: 'Ah,prov',
      demand: Math.round(Ah_req), capacity: Math.round(Ah), unit: 'mm²',
      ratio: Ah_req / (Ah || 1), SF: SF_ah,
      status: Ah >= Ah_req ? 'OK' : 'NG',
      formula: `Ah,req = 0.5·(Asc,req - An) = 0.5×(${Math.round(Asc_req)}-${Math.round(An)}) = ${Math.round(Ah_req)} mm²  ≤  Ah,prov = ${Math.round(Ah)} mm²`,
      steps: [], detail: { 'Ah,req': `${Math.round(Ah_req)} mm²`, 'Ah,prov': `${Math.round(Ah)} mm²` },
    },
  ]
}

function CorbelDiagram({ b, h, a }: { b: number; h: number; a: number }) {
  const W = 280; const H = 260
  const scl = Math.min((W - 60) / (b + a * 2), (H - 60) / h)
  const bw = b * scl; const bh = h * scl; const aw = a * scl
  const ox = (W - bw) / 2; const oy = 20
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#f8fafc" rx="10"/>
      {/* 기둥 (배경) */}
      <rect x={ox} y={oy} width={bw} height={bh} fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5" rx="2"/>
      {/* 코벨 돌출 */}
      <polygon points={`${ox},${oy + bh * 0.3} ${ox - aw},${oy + bh * 0.3} ${ox - aw},${oy + bh * 0.6} ${ox},${oy + bh * 0.6}`}
        fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5"/>
      {/* 하중 화살표 */}
      <line x1={ox - aw / 2} y1={oy} x2={ox - aw / 2} y2={oy + bh * 0.28} stroke="#ef4444" strokeWidth="2" markerEnd="url(#arr)"/>
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#ef4444"/>
        </marker>
      </defs>
      <text x={ox - aw / 2 + 5} y={oy + 14} fill="#dc2626" fontSize="9" fontFamily="JetBrains Mono, monospace">Vu</text>
      {/* a 치수 */}
      <line x1={ox - aw} y1={oy + bh * 0.65} x2={ox} y2={oy + bh * 0.65} stroke="#64748b" strokeWidth="0.8"/>
      <text x={ox - aw / 2} y={oy + bh * 0.65 + 12} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="JetBrains Mono, monospace">a={a}</text>
      <text x={ox + bw / 2} y={oy + bh + 16} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="JetBrains Mono, monospace">b={b}  h={h}</text>
    </svg>
  )
}

export default function CorbelPanel() {
  const [fck, setFck] = useState(27); const [fy, setFy] = useState(400)
  const [b, setB] = useState(400); const [h, setH] = useState(600); const [d, setD] = useState(540)
  const [Vu, setVu] = useState(300); const [Nuc, setNuc] = useState(60); const [a, setA] = useState(200)
  const [Asc, setAsc] = useState(1520); const [Ah, setAh] = useState(600)

  const items = calcCorbel({ fck, fy, b, h, d, Vu, Nuc, a, Asc, Ah })
  const hasNG = items.some(i => i.status === 'NG')
  const overall = hasNG ? 'NG' : 'OK'
  const overallColor = hasNG ? 'var(--danger)' : 'var(--success)'

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
      <div style={{ width: 'clamp(210px, 32%, 340px)', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1.5px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>단 면 도</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: overallColor, background: hasNG ? '#fef2f2' : '#f0fdf4', borderRadius: '6px', padding: '0.18rem 0.6rem', fontFamily: 'var(--font-mono)', border: `1px solid ${overallColor}44` }}>{overall}</span>
        </div>
        <div style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CorbelDiagram b={b} h={h} a={a}/>
        </div>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border-light)', background: 'var(--surface-2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
          {[['b×h', `${b}×${h}`], ['d', `${d} mm`], ['a/d', (a/d).toFixed(3)], ['Vu', `${Vu} kN`]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{k}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
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
              <Field label="b (폭)"       value={b} unit="mm" min={100} step={50} onChange={setB}/>
              <Field label="h (높이)"     value={h} unit="mm" min={100} step={50} onChange={setH}/>
              <Field label="d (유효깊이)" value={d} unit="mm" min={50}            onChange={setD}/>
              <Field label="a (전단경간)" value={a} unit="mm" min={10}  step={10}  onChange={setA}/>
            </div>
          </SectionCard>
          <SectionCard title="하중">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <Field label="Vu (전단)"      value={Vu}  unit="kN" min={0} step={10} onChange={setVu}/>
              <Field label="Nuc (직접인장)" value={Nuc} unit="kN" min={0} step={5}  onChange={setNuc}/>
            </div>
          </SectionCard>
          <SectionCard title="철근">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <Field label="Asc (주철근)"    value={Asc} unit="mm²" min={0} step={100} onChange={setAsc}/>
              <Field label="Ah (수평스터럽)" value={Ah}  unit="mm²" min={0} step={50}  onChange={setAh}/>
            </div>
          </SectionCard>
          <SectionCard title="검토 결과">
            <ResultTable items={items} overallStatus={hasNG ? 'NG' : 'OK'}/>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
