import type { ModuleId } from '../../types'
import { MODULES } from './Sidebar'

interface HeaderProps {
  activeModule: ModuleId
  onMenuOpen?: () => void
  showMenuBtn?: boolean
}

export default function Header({ activeModule, onMenuOpen, showMenuBtn }: HeaderProps) {
  const mod = MODULES.find(m => m.id === activeModule)

  const btnBase: React.CSSProperties = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-dark)',
    borderRadius: '2px',
    color: 'var(--text-2)',
    fontSize: '0.75rem',
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    padding: '0.2rem 0.65rem',
    height: '1.7rem',
    cursor: 'pointer',
    letterSpacing: '0.03em',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

      {/* ── 타이틀 바 ── */}
      <div style={{
        height: '2.2rem',
        background: 'var(--primary)',
        display: 'flex', alignItems: 'center',
        padding: '0 1rem', gap: '0.6rem',
        userSelect: 'none',
      }}>
        {showMenuBtn && (
          <button onClick={onMenuOpen} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.85)', fontSize: '1rem', padding: '0.2rem',
            display: 'flex', alignItems: 'center',
          }}>☰</button>
        )}
        <span style={{
          fontSize: '0.82rem', fontWeight: 700,
          color: '#fff', fontFamily: 'var(--font-mono)',
          letterSpacing: '0.06em',
        }}>RC SECTION</span>
        <span style={{
          fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)',
          fontFamily: 'var(--font-mono)', marginLeft: '0.2rem',
        }}>v1.0</span>

        <div style={{ flex: 1 }}/>

        <span style={{
          fontSize: '0.68rem', color: 'rgba(255,255,255,0.65)',
          fontFamily: 'var(--font-mono)',
        }}>KDS 24 14 21 : 2021</span>
      </div>

      {/* ── 메뉴 툴바 ── */}
      <div style={{
        height: '2rem',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border-dark)',
        display: 'flex', alignItems: 'center',
        padding: '0 0.75rem', gap: '0.2rem',
        userSelect: 'none',
      }}>
        {['파일', '편집', '보기', '도움말'].map(item => (
          <button key={item} style={{
            ...btnBase,
            background: 'none', border: 'none',
            fontSize: '0.75rem', fontWeight: 500, fontFamily: 'var(--font-sans)',
            color: 'var(--text-2)', padding: '0 0.55rem', height: '1.8rem',
          }}>{item}</button>
        ))}

        <div style={{ width: '1px', height: '1.1rem', background: 'var(--border-dark)', margin: '0 0.3rem' }}/>

        {/* 현재 모듈 표시 */}
        <span style={{
          fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)',
          fontFamily: 'var(--font-mono)', padding: '0 0.4rem',
        }}>
          {mod?.label ?? '—'}
        </span>
        <span style={{
          fontSize: '0.68rem', color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
        }}>
          ({mod?.standard})
        </span>

        <div style={{ flex: 1 }}/>

        {/* 설계기준 고정 표시 */}
        <span style={{
          fontSize: '0.68rem', color: 'var(--primary)',
          fontFamily: 'var(--font-mono)', fontWeight: 700,
          background: 'var(--primary-bg)',
          border: '1px solid var(--primary-dim)',
          borderRadius: '2px', padding: '0.1rem 0.55rem',
        }}>KDS</span>
      </div>

    </div>
  )
}
