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
//   cover    = 콘크리트 외면 ~ 스터럽 외면
//   d        = h - cover - stirrup_dia - tension_bar_dia/2
//              (단면 상단 → 인장철근 중심)
//   d'       = cover + stirrup_dia + comp_bar_dia/2
//              (단면 상단 → 압축철근 중심)
// ────────────────────────────────────────────────────────────
export default function SimpleBeamDiagram({
  section, rebar,
  width = 320, height = 390,
}: Props) {
  const mono = 'JetBrains Mono, Consolas, monospace'

  // ── 레이아웃 패딩 ──────────────────────────────────────────
  // 좌: h치수선 + d'치수선 / 우: d치수선 / 하: b치수선
  const padL = 52   // h치수선(8) + 여백(4) + d'치수선(20) + 여백(20)
  const padR = 36   // d치수선(20) + 레이블(10) + 여백(6)
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
  // 철근 중심 y = h - cover - stirrup_dia - dia/2 (하단 기준)
  const tensionBars = rebar.tension.flatMap(layer => {
    const dia = layer.dia
    const r   = barR(dia)
    const barCenterFromBottom = coverMm + stirrupMm + dia / 2
    const yMm = section.h - barCenterFromBottom - (layer.row - 1) * (dia + 6)
    const yPx = oy + yMm * scaleY
    const n   = resolveBarCount(layer)
    const xMarginMm = coverMm + stirrupMm + dia / 2
    const startX    = ox + xMarginMm * scaleX
    const spacingPx = n > 1 ? (drawW - xMarginMm * 2 * scaleX) / (n - 1) : 0
    return Array.from({ length: n }, (_, i) => ({
      cx: n === 1 ? ox + drawW / 2 : startX + i * spacingPx,
      cy: yPx, r, dia, layer,
    }))
  })

  // ── 압축철근 위치 ───────────────────────────────────────────
  // 철근 중심 y = cover + stirrup_dia + dia/2 (상단 기준)
  const compressionBars = rebar.compression.flatMap(layer => {
    const dia = layer.dia
    const r   = barR(dia)
    const barCenterFromTop = coverMm + stirrupMm + dia / 2
    const yMm = barCenterFromTop + (layer.row - 1) * (dia + 6)
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
  // 스터럽 중심선 = cover + stirrup_dia/2 (외면에서)
  const stirrupOffset = coverMm + stirrupMm / 2
  const stirrupX = ox + stirrupOffset * scaleX
  const stirrupY = oy + stirrupOffset * scaleY
  const stirrupW = drawW - stirrupOffset * scaleX * 2
  const stirrupH = drawH - stirrupOffset * scaleY * 2

  // ── 주요 치수값 (mm) ────────────────────────────────────────
  const tDiaMm = rebar.tension[0]?.dia ?? 22
  const cDiaMm = rebar.compression[0]?.dia ?? tDiaMm

  // d  = h - cover - stirrup - t_bar/2  (상단→인장철근 중심)
  const dMm    = section.d   // 패널에서 autod()로 이미 계산된 값
  const dPx    = oy + dMm * scaleY

  // d' = cover + stirrup + c_bar/2  (상단→압축철근 중심)
  const dPrimeMm = coverMm + stirrupMm + cDiaMm / 2
  const dPrimePx = oy + dPrimeMm * scaleY

  // 인장철근 실제 중심 px (치수선 기준점)
  const tBarCy = tensionBars.length > 0 ? tensionBars[0].cy : dPx
  const tBarR  = tensionBars.length > 0 ? tensionBars[0].r  : 4

  // ── 철근 레이블용 ───────────────────────────────────────────
  const tCount = tensionBars.length
  const tLayer0 = rebar.tension[0]
  const barSpacingMm = tLayer0?.inputMode === 'spacing' && (tLayer0?.spacing ?? 0) > 0
    ? tLayer0.spacing!
    : (tCount > 1 ? Math.round(section.b / tCount) : 0)

  // ── 스터럽 다리수 ───────────────────────────────────────────
  const legs = rebar.stirrup_legs ?? 2
  const legXPositions: number[] = []
  if (legs >= 3) {
    const inner = legs - 2
    for (let i = 1; i <= inner; i++)
      legXPositions.push(stirrupX + stirrupW * i / (inner + 1))
  }

  // ── 치수선 좌표 ─────────────────────────────────────────────
  // h 치수선: 최좌측
  const hLineX    = ox - padL + 8
  // d' 치수선: h 치수선 오른쪽
  const dPrimeLX  = ox - padL + 26
  // d 치수선: 단면 우측
  const dLineX    = ox + drawW + 12
  // b 치수선: 하단
  const bLineY    = oy + drawH + 16

  // 마커 색상
  const CLR_DARK  = '#1a2a4a'
  const CLR_MID   = '#3a5080'
  const CLR_GRAY  = '#6a7490'

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
      style={{ display: 'block', userSelect: 'none' }}>
      <defs>
        <pattern id="hatch" x="0" y="0" width="7" height="7"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#e4e7ec"/>
          <line x1="0" y1="0" x2="0" y2="7" stroke="#b0b8c4" strokeWidth="0.75"/>
        </pattern>
        {/* d 화살촉 (진한 남색) */}
        <marker id="arD0" markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M5,0 L0,3 L5,6 Z" fill={CLR_DARK}/>
        </marker>
        <marker id="arD1" markerWidth="5" markerHeight="6" refX="0" refY="3" orient="auto">
          <path d="M0,0 L5,3 L0,6 Z" fill={CLR_DARK}/>
        </marker>
        {/* d' 화살촉 (중간 파랑) */}
        <marker id="arDP0" markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M5,0 L0,3 L5,6 Z" fill={CLR_MID}/>
        </marker>
        <marker id="arDP1" markerWidth="5" markerHeight="6" refX="0" refY="3" orient="auto">
          <path d="M0,0 L5,3 L0,6 Z" fill={CLR_MID}/>
        </marker>
        {/* h/b 화살촉 (회색) */}
        <marker id="arG0" markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M5,0 L0,3 L5,6 Z" fill={CLR_GRAY}/>
        </marker>
        <marker id="arG1" markerWidth="5" markerHeight="6" refX="0" refY="3" orient="auto">
          <path d="M0,0 L5,3 L0,6 Z" fill={CLR_GRAY}/>
        </marker>
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

      {/* ── 스터럽 내부 다리 (legs≥3, 녹색) ── */}
      {legXPositions.map((lx, i) => (
        <g key={`leg${i}`}>
          <line x1={lx} y1={stirrupY} x2={lx} y2={stirrupY + stirrupH}
            stroke="#1a7a3c" strokeWidth="1.6"/>
          <line x1={lx} y1={stirrupY}          x2={lx + 5} y2={stirrupY - 4}
            stroke="#1a7a3c" strokeWidth="1.6" strokeLinecap="round"/>
          <line x1={lx} y1={stirrupY + stirrupH} x2={lx + 5} y2={stirrupY + stirrupH + 4}
            stroke="#1a7a3c" strokeWidth="1.6" strokeLinecap="round"/>
        </g>
      ))}

      {/* ── d 점선 (단면 상단~인장철근 중심 수평선) ── */}
      {tensionBars.length > 0 && (
        <line x1={ox} y1={tBarCy} x2={ox + drawW} y2={tBarCy}
          stroke="#3a5278" strokeWidth="0.75" strokeDasharray="5 2.5"/>
      )}

      {/* ── d' 점선 (단면 상단~압축철근 중심 수평선) ── */}
      {dPrimeMm > 0 && dPrimeMm < section.h && (
        <line x1={ox} y1={dPrimePx} x2={ox + drawW} y2={dPrimePx}
          stroke="#3a5080" strokeWidth="0.6" strokeDasharray="3 2"/>
      )}

      {/* ══════════════════════════════════════════════════════
          치수선
      ══════════════════════════════════════════════════════ */}

      {/* ── h 치수선 (최좌측: 단면 전체 높이) ── */}
      <line x1={ox} y1={oy}         x2={hLineX + 2} y2={oy}
        stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={ox} y1={oy + drawH} x2={hLineX + 2} y2={oy + drawH}
        stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={hLineX} y1={oy} x2={hLineX} y2={oy + drawH}
        stroke={CLR_GRAY} strokeWidth="0.9"
        markerStart="url(#arG0)" markerEnd="url(#arG1)"/>
      <text x={hLineX} y={oy + drawH / 2}
        textAnchor="middle" fill={CLR_GRAY} fontSize="9" fontFamily={mono} fontWeight="600"
        transform={`rotate(-90,${hLineX},${oy + drawH / 2})`}>
        h={section.h}
      </text>

      {/* ── d' 치수선 (좌측 두 번째: 단면 상단 → 압축철근 중심) ── */}
      {dPrimeMm > 0 && dPrimeMm < section.h && (
        <>
          {/* 보조선: 단면 상단에서 왼쪽 */}
          <line x1={ox} y1={oy}        x2={dPrimeLX + 2} y2={oy}
            stroke="#9ba3b2" strokeWidth="0.4" strokeDasharray="2 1.5"/>
          {/* 보조선: d' 위치에서 왼쪽 */}
          <line x1={ox} y1={dPrimePx}  x2={dPrimeLX + 2} y2={dPrimePx}
            stroke="#9ba3b2" strokeWidth="0.4" strokeDasharray="2 1.5"/>
          {/* 치수 화살선 */}
          <line x1={dPrimeLX} y1={oy} x2={dPrimeLX} y2={dPrimePx}
            stroke={CLR_MID} strokeWidth="0.9"
            markerStart="url(#arDP0)" markerEnd="url(#arDP1)"/>
          {/* 레이블 */}
          <text x={dPrimeLX - 2} y={(oy + dPrimePx) / 2 + 4}
            fill={CLR_MID} fontSize="9" fontFamily={mono} fontWeight="700"
            textAnchor="end">d'</text>
        </>
      )}

      {/* ── d 치수선 (우측: 단면 상단 → 인장철근 중심) ── */}
      {tensionBars.length > 0 && dMm > 0 && (
        <>
          {/* 보조선 */}
          <line x1={ox + drawW} y1={oy}    x2={dLineX + 2} y2={oy}
            stroke="#9ba3b2" strokeWidth="0.5" strokeDasharray="2 1.5"/>
          <line x1={ox + drawW} y1={tBarCy} x2={dLineX + 2} y2={tBarCy}
            stroke="#9ba3b2" strokeWidth="0.5" strokeDasharray="2 1.5"/>
          {/* 치수 화살선 */}
          <line x1={dLineX} y1={oy} x2={dLineX} y2={tBarCy}
            stroke={CLR_DARK} strokeWidth="1.0"
            markerStart="url(#arD0)" markerEnd="url(#arD1)"/>
          {/* 레이블 */}
          <text x={dLineX + 4} y={(oy + tBarCy) / 2 + 4}
            fill={CLR_DARK} fontSize="11" fontFamily={mono} fontWeight="800"
            textAnchor="start">d</text>
        </>
      )}

      {/* ── b 치수선 (하단) ── */}
      <line x1={ox}         y1={oy + drawH} x2={ox}         y2={bLineY + 2}
        stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={ox + drawW} y1={oy + drawH} x2={ox + drawW} y2={bLineY + 2}
        stroke="#9ba3b2" strokeWidth="0.45" strokeDasharray="2 1.5"/>
      <line x1={ox} y1={bLineY} x2={ox + drawW} y2={bLineY}
        stroke={CLR_GRAY} strokeWidth="0.9"
        markerStart="url(#arG0)" markerEnd="url(#arG1)"/>
      <text x={ox + drawW / 2} y={bLineY + 11}
        textAnchor="middle" fill={CLR_GRAY} fontSize="9" fontFamily={mono} fontWeight="600">
        b={section.b}
      </text>

      {/* ══════════════════════════════════════════════════════
          철근
      ══════════════════════════════════════════════════════ */}

      {/* ── 압축철근 (십자) ── */}
      {compressionBars.map((b, i) => (
        <g key={`c${i}`}>
          <circle cx={b.cx} cy={b.cy} r={b.r}
            fill="#1e2230" stroke="#1e2230" strokeWidth="0.6"/>
          <line x1={b.cx - b.r * 0.4} y1={b.cy} x2={b.cx + b.r * 0.4} y2={b.cy}
            stroke="#fff" strokeWidth="0.9"/>
          <line x1={b.cx} y1={b.cy - b.r * 0.4} x2={b.cx} y2={b.cy + b.r * 0.4}
            stroke="#fff" strokeWidth="0.9"/>
        </g>
      ))}

      {/* ── 인장철근 (검은 원) ── */}
      {tensionBars.map((b, i) => (
        <circle key={`t${i}`} cx={b.cx} cy={b.cy} r={b.r}
          fill="#1e2230" stroke="#1e2230" strokeWidth="0.6"/>
      ))}

      {/* ── 인장철근 레이블 (철근 위, 단면 내부) ── */}
      {tensionBars.length > 0 && (() => {
        const cx = tensionBars.reduce((s, b) => s + b.cx, 0) / tensionBars.length
        const spacingTxt = tCount > 1 ? `@${barSpacingMm}` : ''
        const label = `D${tDiaMm}(H${tDiaMm})${spacingTxt}`
        return (
          <text x={cx} y={tBarCy - tBarR - 5}
            textAnchor="middle" fill="#1a2040" fontSize="8" fontFamily={mono} fontWeight="600">
            {label}
          </text>
        )
      })()}

      {/* ── 압축철근 레이블 (철근 아래, 단면 내부) ── */}
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

      {/* ── 스터럽 레이블 (단면 내부 우측 세로) ── */}
      {stirrupMm > 0 && (() => {
        const label = `D${rebar.stirrup_dia}@${rebar.stirrup_spacing}-${legs}leg`
        const lx = ox + drawW * 0.78
        const ly = oy + drawH / 2
        return (
          <text x={lx} y={ly} fill="#1a6030" fontSize="7.5" fontFamily={mono} fontWeight="600"
            textAnchor="middle" transform={`rotate(-90,${lx},${ly})`}>
            {label}
          </text>
        )
      })()}
    </svg>
  )
}
