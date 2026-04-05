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

  return (
    <div style={{
      border: '1px solid var(--border-dark)',
      borderRadius: '2px',
      overflow: 'hidden',
      background: 'var(--surface)',
    }}>
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
