import { useState } from 'react'
import type { CheckItem, ModuleId } from '../../types'
import { useResponsive } from '../../hooks/useResponsive'
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

// ── 1방향 슬래브 계산 ───────────────────────────────────────
function calcOneWay(inp: { fck: number; fy: number; h: number; cover: number; ln: number; qu: number; As: number }): CheckItem[] {
  const { fck, fy, h, cover, ln, qu, As } = inp
  const b = 1000   // 단위폭
  const d = h - cover - 8
  const a = As * fy / (0.85 * fck * b)
  const Mn = As * fy * (d - a / 2) * 1e-6   // kN·m/m
  const phi_Mn = 0.85 * Mn
  const Mu = qu * (ln / 1000) ** 2 / 8       // 단순 지지 기준 kN·m/m
  const SF_f = phi_Mn / Mu

  // 최소 두께
  const h_min = ln / 20   // 단순지지
  const SF_h = h / h_min

  // 최소 철근비
  const rho = As / (b * d)
  const rho_min = Math.max(0.0018, 1.4 / fy)
  const SF_rho = rho / rho_min

  return [
    {
      id: 'ow-h', label: '① 최소 두께',
      demandSymbol: 'h,min', capacitySymbol: 'h,prov',
      demand: Math.round(h_min), capacity: h, unit: 'mm',
      ratio: h_min / h, SF: SF_h,
      status: h >= h_min ? 'OK' : 'NG',
      formula: `h,min = ln/20 = ${ln}/20 = ${h_min.toFixed(0)} mm (단순지지)  ≤  h,prov = ${h} mm`,
      steps: [], detail: { 'ln': `${ln} mm`, 'h,min = ln/20': `${h_min.toFixed(0)} mm`, 'h,제공': `${h} mm` },
    },
    {
      id: 'ow-rho', label: '② 최소 철근비',
      demandSymbol: 'ρmin', capacitySymbol: 'ρ,prov',
      demand: rho_min, capacity: Math.round(rho * 100000) / 100000, unit: '',
      ratio: rho_min / (rho || 0.001), SF: SF_rho,
      status: rho >= rho_min ? 'OK' : 'NG',
      formula: `ρmin = max(0.0018, 1.4/fy) = ${rho_min.toFixed(5)}  ≤  ρ = As/(b·d) = ${As}/(${b}×${d}) = ${rho.toFixed(5)}`,
      steps: [], detail: { 'ρ': rho.toFixed(5), 'ρmin': rho_min.toFixed(5), 'As': `${As} mm²/m`, 'd': `${d} mm` },
    },
    {
      id: 'ow-flex', label: '③ 휨 강도 (단위폭)',
      demandSymbol: 'Mu', capacitySymbol: 'φMn',
      demand: Math.round(Mu * 100) / 100, capacity: Math.round(phi_Mn * 100) / 100, unit: 'kN·m/m',
      ratio: Mu / phi_Mn, SF: SF_f,
      status: Mu <= phi_Mn ? 'OK' : 'NG',
      formula: `φMn = 0.85·As·fy·(d - a/2) = 0.85×${As}×${fy}×(${d}-${a.toFixed(1)}/2)×10⁻⁶ = ${phi_Mn.toFixed(2)} kN·m/m  ≥  Mu = qu·ln²/8 = ${qu}×(${ln/1000})²/8 = ${Mu.toFixed(2)} kN·m/m`,
      steps: [], detail: { 'Mu': `${Mu.toFixed(2)} kN·m/m`, 'a': `${a.toFixed(1)} mm`, 'd': `${d} mm`, 'φMn': `${phi_Mn.toFixed(2)} kN·m/m` },
    },
  ]
}

// ── 펀칭 전단 계산 (KDS 14 20 22 : 2022) ───────────────────
function calcPunching(inp: { fck: number; h: number; cover: number; c1: number; c2: number; Vu: number }): CheckItem[] {
  const { fck, h, cover, c1, c2, Vu } = inp
  const d = h - cover - 10
  const lambda = 1.0
  // 임계 둘레 bo (기둥면에서 d/2)
  const bo = 2 * ((c1 + d) + (c2 + d))   // mm
  const betaC = Math.max(c1, c2) / Math.min(c1, c2)

  const Vc1 = (0.33 + 0.17 * (1 + 2 / betaC)) * lambda * Math.sqrt(fck) * bo * d * 1e-3
  const Vc2 = 0.33 * lambda * Math.sqrt(fck) * bo * d * 1e-3
  const Vc  = Math.min(Vc1, Vc2)
  const phi_Vc = 0.75 * Vc
  const SF = phi_Vc / Vu

  return [
    {
      id: 'punch', label: '① 펀칭 전단 강도',
      demandSymbol: 'Vu', capacitySymbol: 'φVc',
      demand: Vu, capacity: Math.round(phi_Vc * 10) / 10, unit: 'kN',
      ratio: Vu / phi_Vc, SF,
      status: Vu <= phi_Vc ? 'OK' : 'NG',
      formula: `φVc = 0.75·min(Vc1, Vc2) = 0.75×${Vc.toFixed(1)} = ${phi_Vc.toFixed(1)} kN  ≥  Vu = ${Vu} kN`,
      steps: [], detail: { 'bo = 2·((c1+d)+(c2+d))': `${bo} mm`, 'd': `${d} mm`, 'βc': betaC.toFixed(2), 'Vc1': `${Vc1.toFixed(1)} kN`, 'Vc2': `${Vc2.toFixed(1)} kN`, 'Vc (min)': `${Vc.toFixed(1)} kN`, 'φVc': `${phi_Vc.toFixed(1)} kN` },
    },
  ]
}

// ── 슬래브 단면도 ───────────────────────────────────────────
function SlabDiagram({ h, type }: { h: number; type: ModuleId }) {
  const W = 280; const H = 200
  const isPunch = type === 'slab-punching'
  if (isPunch) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
        <rect width={W} height={H} fill="#f8fafc" rx="10"/>
        {/* 슬래브 */}
        <rect x={20} y={50} width={240} height={80} fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5" rx="2"/>
        {/* 기둥 */}
        <rect x={110} y={40} width={60} height={100} fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5"/>
        {/* 임계 단면 점선 */}
        <rect x={80} y={30} width={120} height={120} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" rx="4"/>
        <text x={W/2} y={175} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono, monospace">임계 단면 (기둥면 d/2)</text>
        <text x={W/2} y={25} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="JetBrains Mono, monospace">Punching Shear — 평면도</text>
      </svg>
    )
  }
  const scaleH = Math.min(100 / h * 100, 80)
  const sh = scaleH; const sw = 240
  const ox = 20; const oy = (H - sh) / 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="#f8fafc" rx="10"/>
      <defs>
        <pattern id="hatchS" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#d1d9e6" strokeWidth="5"/>
        </pattern>
      </defs>
      <rect x={ox} y={oy} width={sw} height={sh} fill="url(#hatchS)" stroke="#94a3b8" strokeWidth="1.5"/>
      <rect x={ox} y={oy} width={sw} height={sh} fill="rgba(226,232,240,0.55)"/>
      {/* 철근 */}
      {[0.25, 0.5, 0.75].map(r => (
        <circle key={r} cx={ox + sw * r} cy={oy + sh * 0.8} r={4} fill="#16a34a" stroke="#15803d" strokeWidth="0.8"/>
      ))}
      <text x={ox + sw / 2} y={oy + sh + 16} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono, monospace">h = {h} mm (단위폭 1000mm)</text>
    </svg>
  )
}

// ── 메인 슬래브 패널 ────────────────────────────────────────
export default function SlabPanel({ moduleId }: { moduleId: ModuleId }) {
  const isOneWay  = moduleId === 'slab-one-way'
  const isTwoWay  = moduleId === 'slab-two-way'
  const isPunch   = moduleId === 'slab-punching'

  // 공통
  const [fck, setFck] = useState(27)
  const [fy,  setFy]  = useState(400)
  const [h,   setH]   = useState(180)
  const [cover, setCover] = useState(20)

  // 1방향
  const [ln,  setLn]  = useState(4000)
  const [qu,  setQu]  = useState(15)
  const [As,  setAs]  = useState(600)

  // 펀칭
  const [c1, setC1] = useState(400)
  const [c2, setC2] = useState(400)
  const [Vu, setVu] = useState(500)

  let items: CheckItem[] = []
  if (isOneWay || isTwoWay) items = calcOneWay({ fck, fy, h, cover, ln, qu, As })
  if (isPunch) items = calcPunching({ fck, h, cover, c1, c2, Vu })

  const { isCompact } = useResponsive()
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
          <SlabDiagram h={h} type={moduleId}/>
        </div>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border-light)', background: 'var(--surface-2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
          {(isPunch
            ? [['h', `${h} mm`], ['c1×c2', `${c1}×${c2}`], ['Vu', `${Vu} kN`], ['d', `${h - cover - 10} mm`]]
            : [['h', `${h} mm`], ['ln', `${ln} mm`], ['As', `${As} mm²/m`], ['qu', `${qu} kN/m²`]]
          ).map(([k, v]) => (
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
              <Field label="h (두께)" value={h}     unit="mm" min={60}  step={10} onChange={setH}/>
              <Field label="피복두께" value={cover} unit="mm" min={10}  step={5}  onChange={setCover}/>
            </div>
          </SectionCard>

          {(isOneWay || isTwoWay) && (
            <SectionCard title="하중 및 경간">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <Field label="ln (순경간)" value={ln} unit="mm"    min={500} step={100} onChange={setLn}/>
                <Field label="qu (계수하중)" value={qu} unit="kN/m²" min={1}  step={1}  onChange={setQu}/>
                <Field label="As (단위폭)" value={As} unit="mm²/m" min={0}   step={50}  onChange={setAs}/>
              </div>
            </SectionCard>
          )}

          {isPunch && (
            <SectionCard title="기둥 및 하중">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <Field label="c1 (기둥 폭)" value={c1} unit="mm" min={100} step={50} onChange={setC1}/>
                <Field label="c2 (기둥 깊이)" value={c2} unit="mm" min={100} step={50} onChange={setC2}/>
                <Field label="Vu (계수 전단)" value={Vu} unit="kN" min={0} step={10} onChange={setVu}/>
              </div>
            </SectionCard>
          )}

          {isTwoWay && (
            <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '8px', padding: '0.65rem 0.9rem', fontSize: '0.8rem', color: '#92400e' }}>
              ⚠ 2방향 슬래브 직접 설계법(DDM) — 주열대/중간대 배분 기능 개발 예정
            </div>
          )}

          <SectionCard title="검토 결과">
            {items.length > 0
              ? <ResultTable items={items} overallStatus={hasNG ? 'NG' : 'OK'}/>
              : <div style={{ color: 'var(--text-3)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>입력값을 확인하세요</div>
            }
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
