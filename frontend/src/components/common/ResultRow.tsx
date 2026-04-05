import { useState } from 'react'
import type { CheckItem, CalcLine } from '../../types'

const MONO = 'JetBrains Mono, Consolas, monospace'
const KOR  = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'

interface Props { item: CheckItem; striped?: boolean }

// ── 줄노트 한 줄 높이 & 색상 ──────────────────────────────
const LINE_H   = '1.65rem'
const NOTE_BG  = '#fdf8e8'
const NOTE_LINE = '#e8dbb4'
const MARGIN_LINE = '#d4c49a'
const SEC_BG   = '#f5edd4'

// ── 줄노트 래퍼: 좌측 margin line + 하단 줄선 ────────────
function NoteLine({
  children,
  bg,
  minH,
  noBorder,
}: {
  children: React.ReactNode
  bg?: string
  minH?: string
  noBorder?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      minHeight: minH ?? LINE_H,
      background: bg ?? NOTE_BG,
      borderBottom: noBorder ? 'none' : `1px solid ${NOTE_LINE}`,
    }}>
      {/* 좌측 세로 margin line */}
      <div style={{
        width: '2rem',
        flexShrink: 0,
        borderRight: `2px solid ${MARGIN_LINE}`,
      }} />
      {/* 컨텐츠 */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '0.5rem',
        paddingRight: '0.6rem',
        minHeight: minH ?? LINE_H,
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}

// ── 계산과정 한 줄 렌더러 (필기 스타일) ───────────────────
function StepLine({ line }: { line: CalcLine }) {
  const indent = (line.indent ?? 0) * 1.8

  const wrapStyle: React.CSSProperties = {
    wordBreak: 'break-all',
    overflowWrap: 'anywhere',
  }

  switch (line.type) {

    case 'section':
      return (
        <NoteLine bg={SEC_BG}>
          <span style={{
            fontSize: '0.82rem',
            fontWeight: 700,
            color: '#2a2a2a',
            fontFamily: KOR,
            letterSpacing: '0.01em',
            ...wrapStyle,
          }}>{line.text}</span>
        </NoteLine>
      )

    case 'eq-key':
      return (
        <NoteLine>
          <span style={{
            fontSize: '0.82rem',
            fontWeight: 700,
            color: '#1a1f2e',
            fontFamily: MONO,
            paddingLeft: `${indent + 2.4}rem`,
            ...wrapStyle,
          }}>
            {line.text}{line.value ? `\u2003\u2003${line.value}` : ''}
          </span>
        </NoteLine>
      )

    case 'result':
      return (
        <NoteLine>
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '0.5rem',
            width: '100%',
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#1a2440',
              fontFamily: MONO,
              ...wrapStyle,
            }}>{line.text}</span>
            {line.value && (
              <span style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: '#1a2440',
                fontFamily: MONO,
                ...wrapStyle,
              }}>{line.value}</span>
            )}
          </div>
        </NoteLine>
      )

    case 'verdict': {
      const isOk = line.value === 'O.K'
      return (
        <NoteLine bg={isOk ? '#eef6e8' : '#fde8e8'}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            width: '100%',
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: isOk ? '#1a5c30' : '#9a1010',
              fontFamily: MONO,
              flex: 1,
              minWidth: 0,
              ...wrapStyle,
            }}>{line.text}</span>
            <span style={{
              fontSize: '0.82rem',
              fontWeight: 900,
              color: '#fff',
              background: isOk ? '#1a7a3c' : '#c41a1a',
              padding: '0.12rem 0.7rem',
              borderRadius: '1px',
              fontFamily: MONO,
              letterSpacing: '0.06em',
              flexShrink: 0,
            }}>{line.value}</span>
          </div>
        </NoteLine>
      )
    }

    case 'note':
      return (
        <NoteLine>
          <span style={{
            fontSize: '0.72rem',
            color: '#5a5a40',
            fontFamily: MONO,
            fontWeight: 500,
            paddingLeft: `${indent}rem`,
            ...wrapStyle,
          }}>※ {line.text}</span>
        </NoteLine>
      )

    default:
      return (
        <NoteLine>
          <span style={{
            fontSize: '0.78rem',
            fontWeight: 500,
            color: '#2a2a2a',
            fontFamily: MONO,
            paddingLeft: `${indent}rem`,
            ...wrapStyle,
          }}>
            {line.text}{line.value ? `\u2003\u2003${line.value}` : ''}
          </span>
        </NoteLine>
      )
  }
}

// ── 헤더 값 셀 ──────────────────────────────────────────
function ValueCell({
  symbol, symbolColor, value, unit,
}: {
  symbol: string
  symbolColor: string
  value: string
  unit?: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: '0.25rem',
      padding: '0.15rem 0.4rem',
      overflow: 'hidden',
      minWidth: 0,
    }}>
      <span style={{ fontSize: '0.72rem', color: symbolColor, fontWeight: 700, fontFamily: MONO, flexShrink: 0 }}>
        {symbol}
      </span>
      <span style={{ fontSize: '0.62rem', color: 'var(--text-3)', flexShrink: 0 }}>=</span>
      <span style={{
        fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)', fontFamily: MONO,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
      {unit && (
        <span style={{ fontSize: '0.6rem', color: 'var(--text-3)', flexShrink: 0 }}>{unit}</span>
      )}
    </div>
  )
}

// ── 메인 ResultRow ──────────────────────────────────────────
export default function ResultRow({ item, striped }: Props) {
  const [open, setOpen] = useState(true)

  const isOK = item.status === 'OK'
  const isNG = item.status === 'NG'
  const statusColor = isNG ? '#c41a1a' : isOK ? '#1a7a3c' : '#b35c00'
  const hasSteps = item.steps.length > 0

  const demandStr = item.demand.toPrecision(5).replace(/\.?0+$/, '')
  const capacityStr = item.capacity.toPrecision(5).replace(/\.?0+$/, '')

  return (
    <div style={{ borderBottom: '2px solid var(--border-dark)' }}>

      {/* ── 헤더 행 (반응형: flex wrap) ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        background: isNG ? '#fdf0f0' : striped ? 'var(--surface-2)' : 'var(--surface)',
        minHeight: '2.2rem',
      }}>

        {/* 항목명 + 토글 */}
        <button
          onClick={() => hasSteps && setOpen(o => !o)}
          style={{
            background: 'none', border: 'none',
            cursor: hasSteps ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            textAlign: 'left', padding: '0.3rem 0.5rem',
            borderRight: '1px solid var(--border-light)',
            flexShrink: 0,
          }}
        >
          {hasSteps && (
            <span style={{
              fontSize: '0.5rem',
              color: open ? 'var(--primary)' : 'var(--text-disabled)',
              flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'none',
              display: 'inline-block',
              transition: 'transform 0.12s',
            }}>▶</span>
          )}
          <span style={{
            fontSize: '0.8rem', fontWeight: 700,
            color: 'var(--text)',
            fontFamily: KOR,
            whiteSpace: 'nowrap',
          }}>{item.label}</span>
        </button>

        {/* 값 영역: 유연하게 남은 공간 채움 */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          flex: 1,
          alignItems: 'center',
          minWidth: 0,
        }}>
          <ValueCell symbol={item.demandSymbol} symbolColor="#1a4aa0" value={demandStr} unit={item.unit} />
          <ValueCell symbol={item.capacitySymbol} symbolColor="#1a6a3a" value={capacityStr} unit={item.unit} />

          {/* S.F */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: '0.2rem',
            padding: '0.15rem 0.4rem',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-3)', fontFamily: MONO }}>S.F</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: statusColor, fontFamily: MONO }}>
              {isFinite(item.SF) ? item.SF.toFixed(3) : '—'}
            </span>
          </div>

          {/* 판정 배지 */}
          <div style={{ padding: '0.15rem 0.35rem', flexShrink: 0 }}>
            <span style={{
              fontSize: '0.72rem', fontWeight: 800,
              color: '#fff',
              background: statusColor,
              borderRadius: '2px',
              padding: '0.12rem 0.5rem',
              fontFamily: MONO,
              letterSpacing: '0.07em',
            }}>
              {isOK ? 'O.K' : isNG ? 'N.G' : 'WARN'}
            </span>
          </div>
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
        wordBreak: 'break-all',
        overflowWrap: 'anywhere',
      }}>
        {item.formula}
      </div>

      {/* ── 계산과정 (줄노트 필기 스타일) ── */}
      {open && hasSteps && (
        <div style={{
          borderTop: `1px solid ${NOTE_LINE}`,
          background: NOTE_BG,
        }}>
          {item.steps.map((line, i) => (
            <StepLine key={i} line={line}/>
          ))}
        </div>
      )}
    </div>
  )
}
