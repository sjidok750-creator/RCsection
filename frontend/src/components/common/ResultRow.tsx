import { useState } from 'react'
import type { CheckItem, CalcLine } from '../../types'

const MONO = 'JetBrains Mono, Consolas, monospace'
// 한글 전용 폰트 (section 타입 한글 제목용)
const KOR  = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'

interface Props { item: CheckItem; striped?: boolean }

// ── 계산과정 한 줄 렌더러 ──────────────────────────────────
function StepLine({ line }: { line: CalcLine }) {
  const indent = (line.indent ?? 0) * 1.4  // rem

  switch (line.type) {

    // 소제목 (번호+제목 형태) ─────────────────────────────
    case 'section':
      return (
        <div style={{
          marginTop: '0.7rem',
          marginBottom: '0.1rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <span style={{
            fontSize: '0.82rem', fontWeight: 700,
            color: '#1a2440',
            fontFamily: KOR,
            letterSpacing: '0.01em',
          }}>{line.text}</span>
        </div>
      )

    // 중요 계산식 (이중밑줄 + 볼드) ───────────────────────
    case 'eq-key':
      return (
        <div style={{
          display: 'flex', alignItems: 'baseline',
          gap: '0.5rem',
          paddingLeft: `${indent + 1.2}rem`,
          paddingTop: '0.18rem', paddingBottom: '0.18rem',
        }}>
          <span style={{
            fontSize: '0.82rem', fontWeight: 700,
            color: '#1a1f2e',
            fontFamily: MONO,
            flex: 1,
            textDecoration: 'underline double',
            textDecorationColor: '#1a1f2e',
            textUnderlineOffset: '3px',
          }}>{line.text}</span>
          {line.value && (
            <span style={{
              fontSize: '0.88rem', fontWeight: 800,
              color: '#1a1f2e',
              fontFamily: MONO,
              minWidth: '10rem', textAlign: 'right',
              flexShrink: 0,
              textDecoration: 'underline double',
              textDecorationColor: '#1a1f2e',
              textUnderlineOffset: '3px',
            }}>{line.value}</span>
          )}
        </div>
      )

    // 결과 강조 ──────────────────────────────────────────
    case 'result':
      return (
        <div style={{
          display: 'flex', alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '1rem',
          paddingLeft: '1.2rem',
          paddingTop: '0.28rem', paddingBottom: '0.06rem',
        }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1a2440', fontFamily: MONO }}>
            {line.text}
          </span>
          {line.value && (
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1a2440', fontFamily: MONO }}>
              {line.value}
            </span>
          )}
        </div>
      )

    // 판정 (OK=초록 / NG=빨강) ───────────────────────────────
    case 'verdict': {
      const isOk = line.value === 'O.K'
      return (
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          paddingLeft: '1.2rem',
          paddingTop: '0.22rem',
          paddingBottom: '0.1rem',
        }}>
          <span style={{
            fontSize: '0.82rem', fontWeight: 700,
            color: isOk ? '#1a5c30' : '#9a1010',
            fontFamily: MONO,
            flex: 1,
          }}>{line.text}</span>
          <span style={{
            fontSize: '0.82rem', fontWeight: 900,
            color: '#fff',
            background: isOk ? '#1a7a3c' : '#c41a1a',
            padding: '0.12rem 0.7rem',
            borderRadius: '1px',
            fontFamily: MONO,
            letterSpacing: '0.06em',
            flexShrink: 0,
          }}>{line.value}</span>
        </div>
      )
    }

    // 참고사항 (※ 표시, 이탤릭 없음) ────────────────────
    case 'note':
      return (
        <div style={{
          paddingLeft: `${indent + 1.2}rem`,
          paddingTop: '0.1rem',
          paddingBottom: '0.05rem',
        }}>
          <span style={{
            fontSize: '0.74rem',
            color: '#4a5068',
            fontFamily: MONO,
            fontStyle: 'normal',
            fontWeight: 500,
          }}>※ {line.text}</span>
        </div>
      )

    // 일반 계산식 ────────────────────────────────────────────
    default:
      return (
        <div style={{
          display: 'flex', alignItems: 'baseline',
          gap: '0.5rem',
          paddingLeft: `${indent + 1.2}rem`,
          paddingTop: '0.13rem', paddingBottom: '0.13rem',
        }}>
          <span style={{
            fontSize: '0.78rem', fontWeight: 500,
            color: '#2a3050',
            fontFamily: MONO,
            flex: 1,
          }}>{line.text}</span>
          {line.value && (
            <span style={{
              fontSize: '0.78rem', fontWeight: 600,
              color: '#1a2040',
              fontFamily: MONO,
              minWidth: '10rem', textAlign: 'right',
              flexShrink: 0,
            }}>{line.value}</span>
          )}
        </div>
      )
  }
}

// ── 메인 ResultRow ──────────────────────────────────────────
export default function ResultRow({ item, striped }: Props) {
  const [open, setOpen] = useState(true)

  const isOK = item.status === 'OK'
  const isNG = item.status === 'NG'
  const statusColor = isNG ? '#c41a1a' : isOK ? '#1a7a3c' : '#b35c00'
  const hasSteps = item.steps.length > 0

  return (
    <div style={{ borderBottom: '2px solid var(--border-dark)' }}>

      {/* ── 헤더 행 ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '13rem 1fr 1fr 5.5rem 4.5rem',
        alignItems: 'center',
        background: isNG ? '#fdf0f0' : striped ? 'var(--surface-2)' : 'var(--surface)',
        minHeight: '2.3rem',
      }}>

        {/* 항목명 + 토글 */}
        <button
          onClick={() => hasSteps && setOpen(o => !o)}
          style={{
            background: 'none', border: 'none',
            cursor: hasSteps ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            textAlign: 'left', padding: '0.35rem 0.55rem',
            height: '100%',
            borderRight: '1px solid var(--border-light)',
          }}
        >
          {hasSteps && (
            <span style={{
              fontSize: '0.55rem',
              color: open ? 'var(--primary)' : 'var(--text-disabled)',
              flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'none',
              display: 'inline-block',
              transition: 'transform 0.12s',
            }}>▶</span>
          )}
          <span style={{
            fontSize: '0.84rem', fontWeight: 700,
            color: 'var(--text)',
            fontFamily: KOR,
          }}>{item.label}</span>
        </button>

        {/* 요구값 */}
        <div style={{
          padding: '0 0.6rem', display: 'flex', alignItems: 'baseline', gap: '0.3rem',
          borderRight: '1px solid var(--border-light)',
        }}>
          <span style={{ fontSize: '0.75rem', color: '#1a4aa0', fontWeight: 700, fontFamily: MONO }}>
            {item.demandSymbol}
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>=</span>
          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)', fontFamily: MONO }}>
            {item.demand.toPrecision(5).replace(/\.?0+$/, '')}
          </span>
          {item.unit && (
            <span style={{ fontSize: '0.66rem', color: 'var(--text-3)' }}>{item.unit}</span>
          )}
        </div>

        {/* 설계강도 */}
        <div style={{
          padding: '0 0.6rem', display: 'flex', alignItems: 'baseline', gap: '0.3rem',
          borderRight: '1px solid var(--border-light)',
        }}>
          <span style={{ fontSize: '0.75rem', color: '#1a6a3a', fontWeight: 700, fontFamily: MONO }}>
            {item.capacitySymbol}
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>=</span>
          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)', fontFamily: MONO }}>
            {item.capacity.toPrecision(5).replace(/\.?0+$/, '')}
          </span>
          {item.unit && (
            <span style={{ fontSize: '0.66rem', color: 'var(--text-3)' }}>{item.unit}</span>
          )}
        </div>

        {/* 안전율 */}
        <div style={{
          padding: '0 0.6rem', display: 'flex', alignItems: 'baseline', gap: '0.22rem',
          borderRight: '1px solid var(--border-light)',
        }}>
          <span style={{ fontSize: '0.66rem', color: 'var(--text-3)', fontFamily: MONO }}>S.F</span>
          <span style={{ fontSize: '0.92rem', fontWeight: 800, color: statusColor, fontFamily: MONO }}>
            {isFinite(item.SF) ? item.SF.toFixed(3) : '—'}
          </span>
        </div>

        {/* 판정 배지 */}
        <div style={{ padding: '0 0.45rem', display: 'flex', justifyContent: 'center' }}>
          <span style={{
            fontSize: '0.77rem', fontWeight: 800,
            color: '#fff',
            background: statusColor,
            borderRadius: '2px',
            padding: '0.14rem 0.55rem',
            fontFamily: MONO,
            letterSpacing: '0.07em',
            minWidth: '2.8rem',
            textAlign: 'center',
            display: 'block',
          }}>
            {isOK ? 'O.K' : isNG ? 'N.G' : 'WARN'}
          </span>
        </div>
      </div>

      {/* ── 요약식 (항상 표시) ── */}
      <div style={{
        padding: '0.22rem 0.8rem 0.25rem 2rem',
        background: isNG ? '#fdf5f5' : '#f3f6fa',
        borderTop: '1px solid var(--border-light)',
        fontFamily: MONO,
        fontSize: '0.73rem',
        color: isNG ? '#8a1414' : '#3a4155',
        fontWeight: isNG ? 700 : 500,
      }}>
        {item.formula}
      </div>

      {/* ── 계산과정 (노트필기 스타일) ── */}
      {open && hasSteps && (
        <div style={{
          background: '#fafbfd',
          borderTop: '1px solid #d8dde8',
          padding: '0.4rem 1.6rem 0.9rem 1.0rem',
          display: 'flex', flexDirection: 'column', gap: '0',
        }}>
          {item.steps.map((line, i) => (
            <StepLine key={i} line={line}/>
          ))}
        </div>
      )}
    </div>
  )
}
