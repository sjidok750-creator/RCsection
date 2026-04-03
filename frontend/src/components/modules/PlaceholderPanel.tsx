import type { ModuleId } from '../../types'
import { MODULES } from '../layout/Sidebar'

interface Props { moduleId: ModuleId }

export default function PlaceholderPanel({ moduleId }: Props) {
  const mod = MODULES.find(m => m.id === moduleId)
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '0.75rem', color: 'var(--color-text-dim)',
    }}>
      <div style={{ fontSize: '2.5rem' }}>{mod?.icon}</div>
      <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
        {mod?.label} ({mod?.labelEn})
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>
        {mod?.standard} · 개발 예정
      </div>
    </div>
  )
}
