import { useState } from 'react'
import type { ModuleId, ModuleInfo } from '../../types'

export const MODULES: ModuleInfo[] = [
  { id: 'simple-beam',    label: 'RC 보 단면',   labelEn: 'RC Beam Section', group: '보 (Beam)',              standard: 'KDS 14 20 20/22', icon: '▬' },
  { id: 'deep-beam',      label: '깊은보',       labelEn: 'Deep Beam',       group: '보 (Beam)',              standard: 'KDS 14 20 24',    icon: '▰' },
  { id: 'rc-column',      label: 'RC 기둥',      labelEn: 'RC Column',       group: '기둥·벽체 (Column)',     standard: 'KDS 14 20 20/22', icon: '▮' },
  { id: 'rc-wall',        label: '벽체 검토',    labelEn: 'RC Wall',         group: '기둥·벽체 (Column)',     standard: 'KDS 14 20 70',    icon: '▯' },
  { id: 'abutment',       label: '교대 검토',    labelEn: 'Abutment',        group: '교량 하부 (Substructure)', standard: 'KDS 24 14 21',    icon: '⌂' },
  { id: 'foundation',     label: '기초 검토',    labelEn: 'Foundation',      group: '교량 하부 (Substructure)', standard: 'KDS 11 50 15',    icon: '⊓' },
]

interface SidebarProps {
  active: ModuleId
  onSelect: (id: ModuleId) => void
}

export default function Sidebar({ active, onSelect }: SidebarProps) {
  const groups = Array.from(new Set(MODULES.map(m => m.group)))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleGroup = (g: string) =>
    setCollapsed(prev => ({ ...prev, [g]: !prev[g] }))

  return (
    <nav style={{
      width: '15rem',
      minWidth: '15rem',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border-dark)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      userSelect: 'none',
    }}>

      {/* 트리 헤더 */}
      <div style={{
        padding: '0.45rem 0.7rem',
        background: 'var(--surface-3)',
        borderBottom: '1px solid var(--border-dark)',
        fontSize: '0.7rem', fontWeight: 700,
        color: 'var(--text-3)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        fontFamily: 'var(--font-mono)',
      }}>
        Section Type
      </div>

      {/* 트리 바디 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groups.map(group => {
          const isOpen = !collapsed[group]
          const items = MODULES.filter(m => m.group === group)
          return (
            <div key={group}>
              {/* 그룹 헤더 */}
              <button
                onClick={() => toggleGroup(group)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.35rem 0.6rem',
                  background: 'var(--surface-2)',
                  border: 'none',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: '0.62rem', color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  display: 'inline-block',
                  transition: 'transform 0.1s',
                  flexShrink: 0,
                }}>▶</span>
                <span style={{
                  fontSize: '0.75rem', fontWeight: 700,
                  color: 'var(--text-2)',
                  letterSpacing: '0.01em',
                }}>{group}</span>
              </button>

              {/* 항목 목록 */}
              {isOpen && items.map(m => {
                const isActive = m.id === active
                return (
                  <button
                    key={m.id}
                    onClick={() => onSelect(m.id)}
                    className={isActive ? 'tree-item tree-item-active' : 'tree-item'}
                    style={{
                      width: '100%',
                      display: 'flex', alignItems: 'center',
                      gap: '0',
                      padding: '0',
                      background: isActive ? 'var(--primary-bg)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border-light)',
                      borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {/* 들여쓰기 라인 */}
                    <div style={{
                      width: '1.6rem', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      alignSelf: 'stretch',
                      borderRight: '1px dashed var(--border-light)',
                    }}>
                      <div style={{
                        width: '12px', height: '1px',
                        background: 'var(--border-dark)',
                      }}/>
                    </div>

                    {/* 항목 내용 */}
                    <div style={{ flex: 1, padding: '0.38rem 0.55rem' }}>
                      <div style={{
                        fontSize: '0.82rem',
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? 'var(--primary)' : 'var(--text)',
                      }}>{m.label}</div>
                      <div style={{
                        fontSize: '0.65rem',
                        color: isActive ? 'var(--primary)' : 'var(--text-3)',
                        fontFamily: 'var(--font-mono)',
                        marginTop: '1px',
                        opacity: 0.85,
                      }}>{m.labelEn}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* 하단 기준 정보 */}
      <div style={{
        padding: '0.5rem 0.7rem',
        borderTop: '1px solid var(--border-dark)',
        background: 'var(--surface-2)',
      }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
          KDS 24 14 21 : 2021<br />
          도로교설계기준 (한계상태설계법)<br />
          국토교통부 고시
        </div>
      </div>
    </nav>
  )
}
