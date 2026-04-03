import type { ReinforcementInput, SectionInput } from '../../types'

export const REBAR_AREA: Record<number, number> = {
  10: 71.3, 13: 126.7, 16: 198.6, 19: 286.5,
  22: 387.1, 25: 506.7, 29: 642.4, 32: 794.2, 35: 956.6,
}

interface Props {
  section: SectionInput
  rebar: ReinforcementInput
  width?: number
  height?: number
}

// ────────────────────────────────────────────────────────────
// KDS 기준 치수 개념
//   cover (stirrup모드) = 콘크리트 외면 ~ 스터럽 외면
//   cover (center 모드) = 콘크리트 외면 ~ 1단 인장철근 중심
//   d  = 상단 → 인장철근군 도심 (바리뇽 정리, autod로 전달됨)
//   d' = 상단 → 최외단 인장철근(2단) 중심  [2단 배근 시 표시]
//      = 하단 ~ 2단 철근 중심 거리를 상단 기준으로 환산
// 치수선 배치:
//   좌측: h 치수선
//   우측 1열: d (상단→도심)
//   우측 2열: d' (도심→2단 철근 중심) — 2단 배근 시만
// ────────────────────────────────────────────────────────────
export default function SimpleBeamDiagram({
  section, rebar,
  width = 320, height = 390,
}: Props) {
  const mono = 'JetBrains Mono, Consolas, monospace'

  const has2ndRow  = rebar.tension.length >= 2 && (rebar.tension[1]?.count ?? 0) > 0

  // ── 레이아웃 패딩 ──────────────────────────────────────────
  // 우측: d 치수선(14) + 여백(4) + [d' 치수선(14) + 여백(4)] = 36 or 18
  const padL = 38
  const padR = has2ndRow ? 50 : 34
  const padT = 18
  const padB = 30

  const sw = width - padL - padR
  const sh = height - padT - padB

  const aspectRatio = section.h / section.b
  let drawW = sw
  let drawH = sw * aspectRatio
  if (drawH > sh) { drawH = sh; drawW = sh / aspectRatio }

  const ox = padL + (sw - drawW) / 2
  const oy = padT + (sh - drawH) / 2

  const scaleX = drawW / section.b
  const scaleY = drawH / section.h

  const coverMm   = section.cover
  const stirrupMm = rebar.stirrup_dia
  const barScale  = Math.min(scaleX, scaleY)
  const barR = (dia: number) => Math.max((dia / 2) * barScale * 0.78, 3.2)

  // ── 인장철근 개수 결정 ──────────────────────────────────────
  const resolveBarCount = (layer: typeof rebar.tension[0]): number => {
    if (layer.inputMode === 'spacing' && (layer.spacing ?? 0) > 0)
      return Math.floor(section.b / layer.spacing!)
    return layer.count
  }

  // ── 인장철근 위치 ───────────────────────────────────────────
  const coverMode = section.coverMode ?? 'stirrup'
  const tensionBars = rebar.tension.flatMap(layer => {
    const dia = layer.dia
    const r   = barR(dia)
    let barCenterFromBottom: number
    if (coverMode === 'center') {
      barCenterFromBottom = coverMm + (layer.row - 1) * (dia + 25)
    } else {
      barCenterFromBottom = coverMm + stirrupMm + dia / 2 + (layer.row - 1) * (dia + 25)
    }
    const yMm = section.h - barCenterFromBottom
    const yPx = oy + yMm * scaleY
    const n   = resolveBarCount(layer)
    const usedMargin = (coverMm + stirrupMm + dia / 2) * scaleX
    const spacingPx = n > 1 ? (drawW - usedMargin * 2) / (n - 1) : 0
    return Array.from({ length: n }, (_, i) => ({
      cx: n === 1 ? ox + drawW / 2 : ox + usedMargin + i * spacingPx,
      cy: yPx, r, dia, row: layer.row,
    }))
  })

  // ── 압축철근 위치 ───────────────────────────────────────────
  const compressionBars = rebar.compression.flatMap(layer => {
    const dia = layer.dia
    const r   = barR(dia)
    const barCenterFromTop = coverMm + stirrupMm + dia / 2
    const yMm = barCenterFromTop + (layer.row - 1) * (dia + 25)
    const yPx = oy + yMm * scaleY
    const n   = layer.count
    const xMarginMm = coverMm + stirrupMm + dia / 2
    const startX    = ox + xMarginMm * scaleX
    const spacingPx = n > 1 ? (drawW - xMarginMm * 2 * scaleX) / (n - 1) : 0
    return Array.from({ length: n }, (_, i) => ({
      cx: n === 1 ? ox + drawW / 2 : startX + i * spacingPx,
      cy: yPx, r, dia,
    }))
  })

  // ── 스터럽 위치 ─────────────────────────────────────────────
  const tDia1st = rebar.tension[0]?.dia ?? 22
  const stirrupCenterFromEdge = coverMode === 'center'
    ? Math.max(coverMm - tDia1st / 2 - stirrupMm / 2, stirrupMm / 2)
    : coverMm + stirrupMm / 2
  const stirrupX = ox + stirrupCenterFromEdge * scaleX
  const stirrupY = oy + stirrupCenterFromEdge * scaleY
  const stirrupW = drawW - stirrupCenterFromEdge * scaleX * 2
  const stirrupH = drawH - stirrupCenterFromEdge * scaleY * 2

  // ── 치수 기준 좌표 계산 ─────────────────────────────────────
  const tDiaMm = rebar.tension[0]?.dia ?? 22
  const cDiaMm = rebar.compression[0]?.dia ?? tDiaMm

  // d = section.d (autod 바리뇽 도심값, 상단 기준)
  const dMm = section.d
  const dPx = oy + dMm * scaleY   // 도심 y 픽셀

  // 1단 철근 실제 y (레이블용)
  const t1Bars  = tensionBars.filter(b => b.row === 1)
  const t2Bars  = tensionBars.filter(b => b.row === 2)
  const t1BarCy = t1Bars.length > 0 ? t1Bars[0].cy : dPx
  const t1BarR  = t1Bars.length > 0 ? t1Bars[0].r  : 4
  const t2BarCy = t2Bars.length > 0 ? t2Bars[0].cy : dPx
  const t2BarR  = t2Bars.length > 0 ? t2Bars[0].r  : 4

  // d' = 2단 배근 시: 상단 ~ 2단 철근 중심 (d 치수선 아래에 연속 표시)
  // 압축철근 있을 때는 좌측에 별도 표시 (기존 방식 유지)
  const dPrimeMm_comp = compressionBars.length > 0
    ? (coverMm + stirrupMm + cDiaMm / 2) : -1
  const dPrimePx_comp = dPrimeMm_comp > 0 ? oy + dPrimeMm_comp * scaleY : -1

  // ── 레이블용 철근 정보 ──────────────────────────────────────
  const tCount  = t1Bars.length
  const tLayer0 = rebar.tension[0]
  const tLayer1 = rebar.tension[1]
  const barSpacingMm = tLayer0?.inputMode === 'spacing' && (tLayer0?.spacing ?? 0) > 0
    ? tLayer0.spacing!
    : (tCount > 1 ? Math.round(section.b / tCount) : 0)
  const t2Count = t2Bars.length
  const t2Dia   = tLayer1?.dia ?? tDiaMm

  // ── 스터럽 다리수 ───────────────────────────────────────────
  const legs = rebar.stirrup_legs ?? 2
  const legXPositions: number[] = []
  if (legs >= 3) {
    const inner = legs - 2
    for (let i = 1; i <= inner; i++)
      legXPositions.push(stirrupX + stirrupW * i / (inner + 1))
  }

  // ── 치수선 x 좌표 ───────────────────────────────────────────
  const hLineX   = ox - padL + 8          // h 치수선 (최좌측)
  const dLineX   = ox + drawW + 10         // d 치수선 (우측 1열)
  const dPLX     = ox + drawW + 28         // d' 치수선 (우측 2열, 2단 배근 시)
  const dPLX_L   = ox - 14                 // d' 치수선 (좌측, 압축철근 있을 때)
  const bLineY   = oy + drawH + 16         // b 치수선 (하단)

  const CLR_DARK = '#1a2a4a'
  const CLR_D2   = '#3a5080'   // d' 색 (2단)
  const CLR_GRAY = '#6a7490'

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
      style={{ display: 'block', userSelect: 'none' }}>
      <defs>
        <pattern id="hatch" x="0" y="0" width="7" height="7"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#e4e7ec"/>
          <line x1="0" y1="0" x2="0" y2="7" stroke="#b0b8c4" strokeWidth="0.75"/>
        </pattern>
        <marker id="arD0"  markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M5,0 L0,3 L5,6 Z" fill={CLR_DARK}/></marker>
        <marker id="arD1"  markerWidth="5" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill={CLR_DARK}/></marker>
        <marker id="arD20" markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M5,0 L0,3 L5,6 Z" fill={CLR_D2}/></marker>
        <marker id="arD21" markerWidth="5" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill={CLR_D2}/></marker>
        <marker id="arG0"  markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M5,0 L0,3 L5,6 Z" fill={CLR_GRAY}/></marker>
        <marker id="arG1"  markerWidth="5" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill={CLR_GRAY}/></marker>
      </defs>

      {/* 배경 */}
      <rect width={width} height={height} fill="#edf0f4"/>

      {/* ── 콘크리트 본체 ── */}
      <rect x={ox} y={oy} width={drawW} height={drawH}
        fill="url(#hatch)" stroke="#3a4050" strokeWidth="1.6"/>

      {/* ── 스터럽 (녹색) ── */}
      {stirrupMm > 0 && (
        <rect x={stirrupX} y={stirrupY} width={stirrupW} height={stirrupH}
          fill="none" stroke="#1a7a3c" strokeWidth="2.0" strokeLinejoin="miter"/>
      )}

      {/* ── 스터럽 내부 다리 (legs≥3) ── */}
      {legXPositions.map((lx, i) => (
        <g key={`leg${i}`}>
          <line x1={lx} y1={stirrupY} x2={lx} y2={stirrupY + stirrupH} stroke="#1a7a3c" strokeWidth="1.6"/>
          <line x1={lx} y1={stirrupY} x2={lx+5} y2={stirrupY-4} stroke="#1a7a3c" strokeWidth="1.6" strokeLinecap="round"/>
          <line x1={lx} y1={stirrupY+stirrupH} x2={lx+5} y2={stirrupY+stirrupH+4} stroke="#1a7a3c" strokeWidth="1.6" strokeLinecap="round"/>
        </g>
      ))}

      {/* ── d 점선 (도심 위치 수평선) ── */}
      {dMm > 0 && (
        <line x1={ox} y1={dPx} x2={ox + drawW} y2={dPx}
          stroke="#3a5278" strokeWidth="0.75" strokeDasharray="5 2.5"/>
      )}

      {/* ── 2단 철근 중심 점선 (2단 배근 시) ── */}
      {has2ndRow && t2BarCy > 0 && (
        <line x1={ox} y1={t2BarCy} x2={ox + drawW} y2={t2BarCy}
          stroke={CLR_D2} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.7"/>
      )}

      {/* ── d' 점선 (압축철근 있을 때, 상단 기준) ── */}
      {dPrimeMm_comp > 0 && (
        <line x1={ox} y1={dPrimePx_comp} x2={ox + drawW} y2={dPrimePx_comp}
          stroke="#7a6030" strokeWidth="0.55" strokeDasharray="3 2" opacity="0.7"/>
      )}

      {/* ══════ 치수선 ══════ */}

      {/* ── h 치수선 (좌측) ── */}
      <line x1={ox} y1={oy}        x2={hLineX+2} y2={oy}        stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={ox} y1={oy+drawH}  x2={hLineX+2} y2={oy+drawH}  stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={hLineX} y1={oy} x2={hLineX} y2={oy+drawH}
        stroke={CLR_GRAY} strokeWidth="0.9" markerStart="url(#arG0)" markerEnd="url(#arG1)"/>
      <text x={hLineX} y={oy+drawH/2} textAnchor="middle" fill={CLR_GRAY}
        fontSize="9" fontFamily={mono} fontWeight="600"
        transform={`rotate(-90,${hLineX},${oy+drawH/2})`}>h={section.h}</text>

      {/* ── d 치수선 (우측 1열: 상단 → 도심) ── */}
      {dMm > 0 && (
        <>
          <line x1={ox+drawW} y1={oy}   x2={dLineX+2} y2={oy}   stroke="#9ba3b2" strokeWidth="0.5" strokeDasharray="2 1.5"/>
          <line x1={ox+drawW} y1={dPx}  x2={dLineX+2} y2={dPx}  stroke="#9ba3b2" strokeWidth="0.5" strokeDasharray="2 1.5"/>
          <line x1={dLineX} y1={oy} x2={dLineX} y2={dPx}
            stroke={CLR_DARK} strokeWidth="1.0" markerStart="url(#arD0)" markerEnd="url(#arD1)"/>
          <text x={dLineX+4} y={(oy+dPx)/2+4}
            fill={CLR_DARK} fontSize="11" fontFamily={mono} fontWeight="800" textAnchor="start">d</text>
        </>
      )}

      {/* ── d' 치수선 (우측 2열: 도심 → 2단 철근 중심) — 2단 배근 시만 ── */}
      {has2ndRow && dMm > 0 && t2BarCy > dPx && (
        <>
          {/* 보조선: 도심에서 우측 2열로 */}
          <line x1={ox+drawW} y1={dPx}    x2={dPLX+2} y2={dPx}    stroke="#9ba3b2" strokeWidth="0.4" strokeDasharray="2 1.5"/>
          {/* 보조선: 2단 철근 중심에서 우측 2열로 */}
          <line x1={ox+drawW} y1={t2BarCy} x2={dPLX+2} y2={t2BarCy} stroke="#9ba3b2" strokeWidth="0.4" strokeDasharray="2 1.5"/>
          {/* 치수 화살선 */}
          <line x1={dPLX} y1={dPx} x2={dPLX} y2={t2BarCy}
            stroke={CLR_D2} strokeWidth="0.9" markerStart="url(#arD20)" markerEnd="url(#arD21)"/>
          {/* 레이블 */}
          <text x={dPLX+4} y={(dPx+t2BarCy)/2+4}
            fill={CLR_D2} fontSize="9" fontFamily={mono} fontWeight="700" textAnchor="start">d'</text>
        </>
      )}

      {/* ── d' 치수선 (좌측: 압축철근 있을 때, 상단→압축철근 중심) ── */}
      {dPrimeMm_comp > 0 && dPrimePx_comp > 0 && (
        <>
          <line x1={ox} y1={oy}            x2={dPLX_L-2} y2={oy}            stroke="#9ba3b2" strokeWidth="0.4" strokeDasharray="2 1.5"/>
          <line x1={ox} y1={dPrimePx_comp} x2={dPLX_L-2} y2={dPrimePx_comp} stroke="#9ba3b2" strokeWidth="0.4" strokeDasharray="2 1.5"/>
          <line x1={dPLX_L} y1={oy} x2={dPLX_L} y2={dPrimePx_comp}
            stroke="#7a6030" strokeWidth="0.9" markerStart="url(#arD20)" markerEnd="url(#arD21)"/>
          <text x={dPLX_L-2} y={(oy+dPrimePx_comp)/2+4}
            fill="#7a6030" fontSize="9" fontFamily={mono} fontWeight="700" textAnchor="end">d'</text>
        </>
      )}

      {/* ── b 치수선 (하단) ── */}
      <line x1={ox}        y1={oy+drawH} x2={ox}        y2={bLineY+2} stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={ox+drawW}  y1={oy+drawH} x2={ox+drawW}  y2={bLineY+2} stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={ox} y1={bLineY} x2={ox+drawW} y2={bLineY}
        stroke={CLR_GRAY} strokeWidth="0.9" markerStart="url(#arG0)" markerEnd="url(#arG1)"/>
      <text x={ox+drawW/2} y={bLineY+11}
        textAnchor="middle" fill={CLR_GRAY} fontSize="9" fontFamily={mono} fontWeight="600">
        b={section.b}
      </text>

      {/* ══════ 철근 ══════ */}

      {/* ── 압축철근 (십자) ── */}
      {compressionBars.map((b, i) => (
        <g key={`c${i}`}>
          <circle cx={b.cx} cy={b.cy} r={b.r} fill="#1e2230" stroke="#1e2230" strokeWidth="0.6"/>
          <line x1={b.cx-b.r*0.4} y1={b.cy} x2={b.cx+b.r*0.4} y2={b.cy} stroke="#fff" strokeWidth="0.9"/>
          <line x1={b.cx} y1={b.cy-b.r*0.4} x2={b.cx} y2={b.cy+b.r*0.4} stroke="#fff" strokeWidth="0.9"/>
        </g>
      ))}

      {/* ── 인장철근 (검은 원) ── */}
      {tensionBars.map((b, i) => (
        <circle key={`t${i}`} cx={b.cx} cy={b.cy} r={b.r}
          fill="#1e2230" stroke="#1e2230" strokeWidth="0.6"/>
      ))}

      {/* ── 도심 마커 (△, 2단 배근 시만) ── */}
      {has2ndRow && dMm > 0 && (() => {
        const cx = ox + drawW / 2
        const cy = dPx
        const s  = 5
        return (
          <polygon points={`${cx},${cy-s} ${cx-s},${cy+s} ${cx+s},${cy+s}`}
            fill="none" stroke={CLR_DARK} strokeWidth="1.0" opacity="0.7"/>
        )
      })()}

      {/* ── 1단 인장철근 레이블 ── */}
      {t1Bars.length > 0 && (() => {
        const cx = t1Bars.reduce((s, b) => s + b.cx, 0) / t1Bars.length
        const spacingTxt = tCount > 1 ? `@${barSpacingMm}` : ''
        const label = `D${tDiaMm}(H${tDiaMm})${spacingTxt}`
        return (
          <text x={cx} y={t1BarCy - t1BarR - 5}
            textAnchor="middle" fill="#1a2040" fontSize="8" fontFamily={mono} fontWeight="600">
            {label}
          </text>
        )
      })()}

      {/* ── 2단 인장철근 레이블 ── */}
      {has2ndRow && t2Bars.length > 0 && (() => {
        const cx = t2Bars.reduce((s, b) => s + b.cx, 0) / t2Bars.length
        const label = `${t2Count}-D${t2Dia}(H${t2Dia})`
        return (
          <text x={cx} y={t2BarCy + t2BarR + 9}
            textAnchor="middle" fill="#1a2040" fontSize="8" fontFamily={mono} fontWeight="600">
            {label}
          </text>
        )
      })()}

      {/* ── 압축철근 레이블 ── */}
      {compressionBars.length > 0 && (() => {
        const firstBar = compressionBars[0]
        const cx  = compressionBars.reduce((s, b) => s + b.cx, 0) / compressionBars.length
        const cnt = rebar.compression[0]?.count ?? 0
        const label = `${cnt > 0 ? `${cnt}-` : ''}D${cDiaMm}(H${cDiaMm})`
        return (
          <text x={cx} y={firstBar.cy + firstBar.r + 9}
            textAnchor="middle" fill="#1a2040" fontSize="8" fontFamily={mono} fontWeight="600">
            {label}
          </text>
        )
      })()}

      {/* ── 스터럽 레이블 (우측 세로) ── */}
      {stirrupMm > 0 && (() => {
        const label = `D${rebar.stirrup_dia}@${rebar.stirrup_spacing}-${legs}leg`
        const lx = ox + drawW * 0.78
        const ly = oy + drawH / 2
        return (
          <text x={lx} y={ly} fill="#1a6030" fontSize="7.5" fontFamily={mono} fontWeight="600"
            textAnchor="middle" transform={`rotate(-90,${lx},${ly})`}>{label}</text>
        )
      })()}
    </svg>
  )
}
