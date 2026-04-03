import type { CheckItem, CheckStatus } from '../../types'
import ResultRow from './ResultRow'

interface Props {
  items: CheckItem[]
  overallStatus: CheckStatus
}

export default function ResultTable({ items, overallStatus }: Props) {
  const isNG = overallStatus === 'NG'
  const statusColor = isNG ? 'var(--danger)' : overallStatus === 'WARN' ? 'var(--warning)' : 'var(--success)'
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

  const colStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '0.32rem 0.5rem',
  }

  return (
    <div style={{
      border: '1px solid var(--border-dark)',
      borderRadius: '2px',
      overflow: 'hidden',
      background: 'var(--surface)',
    }}>
      {/* 헤더 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '12rem 1fr 1fr 5.5rem 4.5rem',
        background: 'var(--surface-3)',
        borderBottom: '1px solid var(--border-dark)',
        alignItems: 'center',
      }}>
        {['검토 항목', '요구값  Demand', '설계강도  Capacity', 'S.F', '판정'].map((h, i) => (
          <span key={i} style={colStyle}>{h}</span>
        ))}
      </div>

      {/* 각 행 */}
      <div>
        {items.map((item, i) => (
          <ResultRow key={item.id} item={item} striped={i % 2 === 1}/>
        ))}
      </div>

      {/* 최종 판정 */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        gap: '0.6rem',
        padding: '0.4rem 0.7rem',
        background: isNG ? 'var(--danger-bg)' : overallStatus === 'WARN' ? 'var(--warning-bg)' : 'var(--success-bg)',
        borderTop: '1px solid var(--border-dark)',
      }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)' }}>최종 판정</span>
        <span style={{
          fontSize: '0.82rem', fontWeight: 800,
          color: '#fff', background: statusColor,
          borderRadius: '2px', padding: '0.18rem 0.85rem',
          ...mono, letterSpacing: '0.08em',
        }}>
          {isNG ? 'N.G' : overallStatus === 'WARN' ? 'WARN' : 'O.K'}
        </span>
      </div>
    </div>
  )
}
