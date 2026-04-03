import type { ModuleId } from '../../types'
import { MODULES } from './Sidebar'

interface MobileNavProps {
  active: ModuleId
  onSelect: (id: ModuleId) => void
  onClose: () => void
}

export default function MobileNav({ active, onSelect, onClose }: MobileNavProps) {
  const groups = Array.from(new Set(MODULES.map(m => m.group)))
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.35)', zIndex: 40,
      }}/>
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: '15rem',
        background: 'var(--surface)', borderRight: '1.5px solid var(--border)',
        zIndex: 50, display: 'flex', flexDirection: 'column',
        animation: 'slideLeft 0.2s ease',
        boxShadow: '4px 0 20px rgba(0,0,0,0.1)',
      }}>
        <div style={{
          padding: '1rem 1.1rem', borderBottom: '1.5px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '2rem', height: '2rem', background: 'var(--primary)',
              borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)',
            }}>RC</div>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>RC Section</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '1.2rem' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
          {groups.map(group => (
            <div key={group}>
              <div style={{
                fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-disabled)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                padding: '0.8rem 1.1rem 0.35rem',
              }}>{group}</div>
              {MODULES.filter(m => m.group === group).map(m => {
                const isActive = m.id === active
                return (
                  <button key={m.id} onClick={() => { onSelect(m.id); onClose() }} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '0.65rem',
                    padding: '0.65rem 1.1rem',
                    background: isActive ? 'var(--primary-bg)' : 'transparent',
                    border: 'none', borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                    <span style={{ fontSize: '1rem', color: isActive ? 'var(--primary)' : 'var(--text-3)' }}>{m.icon}</span>
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--primary)' : 'var(--text)' }}>{m.label}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{m.standard}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
