import type { ReinforcementInput, SectionInput } from '../../types'

export const REBAR_AREA: Record<number, number> = {
  10: 71.3, 13: 126.7, 16: 198.6, 19: 286.5,
  22: 387.1, 25: 506.7, 29: 642.4, 32: 794.2, 35: 956.6,
}

interface Props {
  section: SectionInput
  rebar: ReinforcementInput
  fy?: number
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
  section, rebar, fy = 400,
  width = 320, height = 390,
}: Props) {
  const mono = 'JetBrains Mono, Consolas, monospace'
  // fy ≤ 300MPa (SD300 이하) → D, 초과 → H
  const rebarPrefix = fy <= 300 ? 'D' : 'H'

  const has2ndRow  = rebar.tension.length >= 2 && (rebar.tension[1]?.count ?? 0) > 0

  // ── 레이아웃 패딩 ──────────────────────────────────────────
  // 우측: d 치수선(14) + 여백(4) + [d' 치수선(14) + 여백(4)] = 36 or 18
  const padL = 38
  const padR = has2ndRow ? 50 : 34
  const padT = 18
  // 하단: b 치수선(16) + 간격(4) + 철근 레이블 줄수×13
  const rebarRowCount = rebar.tension.filter((_, i) => i === 0 || (rebar.tension[1]?.count ?? 0) > 0).length
  const padB = 30 + rebarRowCount * 13

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
  const t2BarCy = t2Bars.length > 0 ? t2Bars[0].cy : dPx

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

  // ── 하단 철근 레이블 (1열/2열) ────────────────────────────
  // 표기: "1열 : H22@125 = 1548 mm²"
  const t1Area = tCount * (REBAR_AREA[tDiaMm] ?? 0)
  const t1SpacingStr = barSpacingMm > 0 ? `@${barSpacingMm}` : ''
  const t1Label = tCount > 0
    ? `1열 : ${rebarPrefix}${tDiaMm}${t1SpacingStr} (${tCount}개) = ${Math.round(t1Area)} mm²`
    : ''
  const t2Area = t2Count * (REBAR_AREA[t2Dia] ?? 0)
  const t2SpacingMm = tLayer1?.inputMode === 'spacing' && (tLayer1?.spacing ?? 0) > 0
    ? tLayer1.spacing!
    : (t2Count > 1 ? Math.round(section.b / t2Count) : 0)
  const t2SpacingStr = t2SpacingMm > 0 ? `@${t2SpacingMm}` : ''
  const t2Label = has2ndRow && t2Count > 0
    ? `2열 : ${rebarPrefix}${t2Dia}${t2SpacingStr} (${t2Count}개) = ${Math.round(t2Area)} mm²`
    : ''

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

      {/* ── 하단 철근 레이블 (b 치수선 아래) ── */}
      {t1Label && (
        <text x={ox + drawW / 2} y={bLineY + 24}
          textAnchor="middle" fill="#1a2040" fontSize="8.5" fontFamily={mono} fontWeight="600">
          {t1Label}
        </text>
      )}
      {t2Label && (
        <text x={ox + drawW / 2} y={bLineY + 38}
          textAnchor="middle" fill={CLR_D2} fontSize="8.5" fontFamily={mono} fontWeight="600">
          {t2Label}
        </text>
      )}

      {/* ── 압축철근 레이블 ── */}
      {compressionBars.length > 0 && (() => {
        const firstBar = compressionBars[0]
        const cx  = compressionBars.reduce((s, b) => s + b.cx, 0) / compressionBars.length
        const cnt = rebar.compression[0]?.count ?? 0
        const label = `${cnt > 0 ? `${cnt}-` : ''}${rebarPrefix}${cDiaMm}`
        return (
          <text x={cx} y={firstBar.cy + firstBar.r + 9}
            textAnchor="middle" fill="#1a2040" fontSize="8" fontFamily={mono} fontWeight="600">
            {label}
          </text>
        )
      })()}

      {/* ── 스터럽 레이블 (우측 세로) ── */}
      {stirrupMm > 0 && (() => {
        const label = `${rebarPrefix}${rebar.stirrup_dia}@${rebar.stirrup_spacing}-${legs}leg`
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

// ────────────────────────────────────────────────────────────
// RC 보 휨 단면 해석도 — 설계용 기술도면 수준
//   열 ①  단면 (Cross Section)
//   열 ②  변형률도 (Strain Diagram)
//   열 ③  응력블록 + 합력 (Stress Block & Forces)
// ────────────────────────────────────────────────────────────
interface StrainForceProps {
  b: number       // 폭 mm
  h: number       // 전체 높이 mm
  d: number       // 유효깊이 mm
  c: number       // 중립축 깊이 mm
  a: number       // 등가블록 깊이 mm
  As: number      // 인장철근 단면적 mm²
  fy: number      // 항복강도 MPa
  fck: number     // 콘크리트 강도 MPa
  Et: number      // 인장변형률 εt
  Ey: number      // 항복변형률 εy
  width?: number
  height?: number
}

export function StrainForceDiagram({
  b, h, d, c, a, As, fy, fck,
  Et, Ey,
  width = 560, height = 230,
}: StrainForceProps) {
  // ── 폰트 / 색상 ────────────────────────────────────────────
  const mono  = 'JetBrains Mono, Consolas, monospace'
  const INK   = '#111111'   // 주 선 / 텍스트
  const INK2  = '#666666'   // 보조 (치수선, 부가 텍스트)
  const GREY  = '#c8c8c8'   // 콘크리트 해칭선
  const HATCH = '#d4d4d4'   // 압축블록 해칭 배경

  // ── 레이아웃 고정값 (width=560, height=230) ───────────────
  //   padT: 상단 레이블 여백   padB: 하단 제목 여백
  const padT = 26, padB = 22
  const drawH = height - padT - padB   // 단면 그리는 높이

  // 단면 폭: b/h 비율 반영, 범위 [60, 110] px
  const secW = Math.min(Math.max(Math.round(drawH * b / h), 60), 110)

  // ── 3열 배치 (좌표 직접 지정) ────────────────────────────
  // 각 열의 단면 사각형 좌측 x:
  //   col1: Section           → x=42  (좌측 h 치수선 35px 확보)
  //   col2: Strain Diagram    → col1 + secW + gap
  //   col3: Stress & Forces   → col2 + secW + gap
  // 우측 여백: z 치수선 + 레이블 약 55px
  const col1X = 42
  const totalUsed = col1X + secW * 3 + 55   // 최소 필요 폭
  const gap   = Math.max(Math.floor((width - totalUsed) / 2), 14)
  const col2X = col1X + secW + gap
  const col3X = col2X + secW + gap

  const secY  = padT
  const scaleY = drawH / h

  // ── 주요 y 좌표 ──────────────────────────────────────────
  const cPx = c * scaleY   // 중립축 (압축연단에서)
  const aPx = a * scaleY   // 응력블록 하단
  const dPx = d * scaleY   // 유효깊이 (철근 중심)

  // ── 힘 계산 ──────────────────────────────────────────────
  const Cc  = 0.85 * fck * a * b * 1e-3   // kN
  const Ts  = As * fy * 1e-3               // kN
  const z   = d - a / 2                    // 모멘트 팔 mm
  const beta1 = fck <= 28 ? 0.85 : Math.max(0.85 - 0.007 * (fck - 28), 0.65)

  // ── 텍스트 포맷 ──────────────────────────────────────────
  const f1  = (v: number) => v.toFixed(1)
  const f4  = (v: number) => v.toFixed(4)
  const fi  = (v: number) => Math.round(v).toLocaleString()

  // ── 수직 치수선 헬퍼 ─────────────────────────────────────
  // x: 치수선 x좌표 / y1,y2: 범위 / label: 레이블 / side: 레이블 방향
  // extL, extR: 연장선 출발 x (단면 좌/우에서 치수선까지)
  const VDim = ({
    x, y1, y2, label, side = 'right', extL, extR,
  }: {
    x: number; y1: number; y2: number; label: string
    side?: 'right' | 'left'; extL?: number; extR?: number
  }) => {
    const AH = 5, AW = 3.5   // 화살촉 높이/반폭
    const mid = (y1 + y2) / 2
    const lx  = side === 'right' ? x + 4 : x - 4
    const minSpan = AH * 2 + 2
    const span = Math.abs(y2 - y1)
    return (
      <g>
        {extL !== undefined && <line x1={extL} y1={y1} x2={x} y2={y1} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>}
        {extR !== undefined && <line x1={extR} y1={y1} x2={x} y2={y1} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>}
        {extL !== undefined && <line x1={extL} y1={y2} x2={x} y2={y2} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>}
        {extR !== undefined && <line x1={extR} y1={y2} x2={x} y2={y2} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>}
        {span >= minSpan
          ? <>
              <line x1={x} y1={y1 + AH} x2={x} y2={y2 - AH} stroke={INK} strokeWidth="0.85"/>
              <polygon points={`${x},${y1} ${x-AW},${y1+AH} ${x+AW},${y1+AH}`} fill={INK}/>
              <polygon points={`${x},${y2} ${x-AW},${y2-AH} ${x+AW},${y2-AH}`} fill={INK}/>
            </>
          : <line x1={x} y1={y1} x2={x} y2={y2} stroke={INK} strokeWidth="0.85"/>
        }
        {label && (
          <text x={lx} y={mid + 4} fontSize="8.5" fontFamily={mono} fontWeight="700"
            fill={INK} textAnchor={side === 'right' ? 'start' : 'end'}>
            {label}
          </text>
        )}
      </g>
    )
  }

  // ── 수평 치수선 헬퍼 ─────────────────────────────────────
  const HDim = ({
    x1, x2, y, label, below = true,
  }: {
    x1: number; x2: number; y: number; label: string; below?: boolean
  }) => {
    const AH = 4, AW = 3
    const mx = (x1 + x2) / 2
    const ly = below ? y + 12 : y - 5
    return (
      <g>
        <line x1={x1 + AH} y1={y} x2={x2 - AH} y2={y} stroke={INK} strokeWidth="0.85"/>
        <polygon points={`${x1},${y} ${x1+AH},${y-AW} ${x1+AH},${y+AW}`} fill={INK}/>
        <polygon points={`${x2},${y} ${x2-AH},${y-AW} ${x2-AH},${y+AW}`} fill={INK}/>
        <text x={mx} y={ly} fontSize="8.5" fontFamily={mono} fontWeight="700"
          fill={INK} textAnchor="middle">
          {label}
        </text>
      </g>
    )
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
      style={{ display: 'block', background: '#ffffff' }}>
      <defs>
        {/* 콘크리트 해칭 (단면) */}
        <pattern id="sfd-conc" x="0" y="0" width="6" height="6"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#eeeeee"/>
          <line x1="0" y1="0" x2="0" y2="6" stroke={GREY} strokeWidth="0.6"/>
        </pattern>
        {/* 압축블록 해칭 (45° 사선) */}
        <pattern id="sfd-comp" x="0" y="0" width="5" height="5"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={HATCH}/>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#999999" strokeWidth="0.75"/>
        </pattern>
        {/* 변형률 압축측 채움 */}
        <pattern id="sfd-strain-c" x="0" y="0" width="5" height="5"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#e0e0e0"/>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#bbbbbb" strokeWidth="0.5"/>
        </pattern>
      </defs>

      {/* ══════════════════════════════════════════════════════
          ①  SECTION  (단면도)
      ══════════════════════════════════════════════════════ */}
      {(() => {
        const sx = col1X, sy = secY
        const sw = secW, sh = drawH

        // 철근: 8개, b/h 비율로 배치 (단면 내 실제 위치 반영)
        const nBar    = 8
        const coverPx = Math.max(sh * 0.065, 6)   // 피복 픽셀
        const barR    = Math.max(sw * 0.042, 3.2)
        const barY    = sy + dPx
        const barSpan = sw - coverPx * 2
        const barSpc  = barSpan / (nBar - 1)

        // h 치수선 x (단면 좌측)
        const hDimX = sx - 16
        // d + (h-d) 치수선 x (단면 우측)
        const dDimX = sx + sw + 14

        return (
          <g>
            {/* 콘크리트 본체 */}
            <rect x={sx} y={sy} width={sw} height={sh}
              fill="url(#sfd-conc)" stroke={INK} strokeWidth="1.7"/>

            {/* 중립축 점선 + N.A 레이블 */}
            <line x1={sx} y1={sy + cPx} x2={sx + sw} y2={sy + cPx}
              stroke={INK} strokeWidth="0.85" strokeDasharray="5 3"/>
            <text x={sx + sw + 3} y={sy + cPx - 2}
              fontSize="7.5" fontFamily={mono} fill={INK2} fontWeight="600">N.A</text>

            {/* 유효깊이 d 점선 */}
            <line x1={sx} y1={sy + dPx} x2={sx + sw} y2={sy + dPx}
              stroke={INK2} strokeWidth="0.6" strokeDasharray="3 2"/>

            {/* 철근 8개 */}
            {Array.from({ length: nBar }, (_, i) => (
              <circle key={i}
                cx={sx + coverPx + i * barSpc} cy={barY} r={barR}
                fill={INK} stroke={INK} strokeWidth="0.4"/>
            ))}

            {/* ── h 치수선 (좌측) ── */}
            <VDim x={hDimX} y1={sy} y2={sy + sh} label={`h = ${h}`} side="left"/>

            {/* ── d 치수선 (우측 — 상단 ~ 철근중심) ── */}
            <VDim x={dDimX} y1={sy} y2={sy + dPx} label="d" side="right"/>

            {/* ── (h−d) 치수선 없음 — 공간 절약; d 치수선으로 충분 ── */}

            {/* ── b 치수선 (하단) ── */}
            {(() => {
              const by = sy + sh + 13
              // 연장선
              return (
                <g>
                  <line x1={sx}      y1={sy + sh} x2={sx}      y2={by + 3} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  <line x1={sx + sw} y1={sy + sh} x2={sx + sw} y2={by + 3} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  <HDim x1={sx} x2={sx + sw} y={by} label={`b = ${b}`} below={true}/>
                </g>
              )
            })()}

            {/* ── 열 제목 ── */}
            <text x={sx + sw / 2} y={height - 5}
              textAnchor="middle" fontSize="9" fontFamily={mono} fill={INK} fontWeight="800">
              Section
            </text>
          </g>
        )
      })()}

      {/* ══════════════════════════════════════════════════════
          ②  STRAIN DIAGRAM  (변형률도)
          변형률 분포는 좌측 0-축 기준, 오른쪽으로 양수
          단면 외곽 사각형에 겹쳐서 그림
      ══════════════════════════════════════════════════════ */}
      {(() => {
        const sx = col2X, sy = secY
        const sw = secW

        // εcu 와 εt 중 큰 값 기준으로 폭 스케일
        const eMax  = Math.max(0.003, Math.abs(Et), 0.003) * 1.10
        // 변형률 → 픽셀 (최대 sw까지)
        const toEX  = (e: number) => sw * Math.abs(e) / eMax

        const eCuPx = toEX(0.003)       // 상단 오른쪽 끝 (εcu)
        const eTX   = toEX(Math.abs(Et))  // d 위치 오른쪽 끝 (εt)

        const cY = sy + cPx
        const dY = sy + dPx

        // 변형률 삼각형 꼭짓점
        // 압축측: (sx,sy) → (sx+eCuPx, sy) → (sx, cY) [0-축 기준]
        // 인장측: (sx, cY) → (sx+eTX, dY) → (sx, dY)
        const compPts = `${sx},${sy} ${sx + eCuPx},${sy} ${sx},${cY}`
        const tensPts = `${sx},${cY} ${sx + eTX},${dY} ${sx},${dY}`

        // c 치수선: 단면 우측에 붙임
        const cDimX = sx + sw + 12

        return (
          <g>
            {/* 외곽선 (단면 경계) */}
            <rect x={sx} y={sy} width={sw} height={drawH}
              fill="none" stroke={INK} strokeWidth="1.5"/>

            {/* 압축측 변형률 삼각형 */}
            <polygon points={compPts}
              fill="url(#sfd-strain-c)" stroke={INK} strokeWidth="1.0"/>

            {/* 인장측 변형률 삼각형 */}
            <polygon points={tensPts}
              fill="#f4f4f4" stroke={INK} strokeWidth="1.0"/>

            {/* 0-축 (중립축) 수직선 강조 */}
            <line x1={sx} y1={sy} x2={sx} y2={sy + drawH}
              stroke={INK} strokeWidth="1.5"/>

            {/* 중립축 수평 점선 */}
            <line x1={sx} y1={cY} x2={sx + sw} y2={cY}
              stroke={INK} strokeWidth="0.85" strokeDasharray="5 3"/>

            {/* d 위치 점선 */}
            <line x1={sx} y1={dY} x2={sx + sw} y2={dY}
              stroke={INK2} strokeWidth="0.6" strokeDasharray="3 2"/>

            {/* ── εcu = 0.003 레이블 (상단, 삼각형 오른쪽 위) ── */}
            <text x={sx + eCuPx + 2} y={sy + 9}
              fontSize="8.5" fontFamily={mono} fill={INK} fontWeight="700">
              ε<tspan fontSize="7" dy="1.5">cu</tspan><tspan dy="-1.5"> =0.003</tspan>
            </text>

            {/* ── εt 레이블 (d 위치 하단) ── */}
            <text x={sx + eTX + 2} y={dY + 2}
              fontSize="8.5" fontFamily={mono} fill={INK} fontWeight="700">
              ε<tspan fontSize="7" dy="1.5">t</tspan>
              <tspan dy="-1.5"> ={f4(Et)}</tspan>
            </text>

            {/* 인장지배 여부 (소형) */}
            <text x={sx + 2} y={dY + 13}
              fontSize="7" fontFamily={mono} fill={INK2}>
              {Et >= 0.005 ? '(tension-ctrl)' : Et >= Ey ? `(≥ εy)` : `(< εy)`}
            </text>

            {/* ── c 치수선 (우측) ── */}
            <VDim x={cDimX} y1={sy} y2={cY} label="c" side="right"
              extR={sx + sw}/>

            {/* ── 열 제목 ── */}
            <text x={sx + sw / 2} y={height - 5}
              textAnchor="middle" fontSize="9" fontFamily={mono} fill={INK} fontWeight="800">
              Strain Diagram
            </text>
          </g>
        )
      })()}

      {/* ══════════════════════════════════════════════════════
          ③  STRESS BLOCK & FORCES
          - 단면 외곽
          - 압축블록 해칭 (상단 ~ a)
          - C 화살표 (←, 오른쪽에서 단면으로)
          - T 화살표 (→, 왼쪽에서 단면으로)
          - a, c, d, z 치수선
          - a = β₁·c 관계식
          - C = T 평형 표기
      ══════════════════════════════════════════════════════ */}
      {(() => {
        const sx = col3X, sy = secY
        const sw = secW

        const cY = sy + cPx
        const aY = sy + aPx    // 응력블록 하단
        const dY = sy + dPx    // 철근 중심
        const CY = sy + aPx / 2  // 압축 합력 작용점 (a/2)
        const TY = dY            // 인장 합력 작용점

        // 화살표 길이 (고정값, 충분한 레이블 공간)
        const ALEN = 32

        // 치수선 x 위치
        const aXL   = sx - ALEN - 18   // a 치수선 (왼쪽)
        const dXR   = sx + sw + ALEN + 18  // d 치수선 (오른쪽)
        const zXR   = dXR + 16            // z 치수선 (오른쪽 2열)

        return (
          <g>
            {/* 단면 외곽 */}
            <rect x={sx} y={sy} width={sw} height={drawH}
              fill="none" stroke={INK} strokeWidth="1.5"/>

            {/* 압축블록 해칭 */}
            <rect x={sx} y={sy} width={sw} height={aPx}
              fill="url(#sfd-comp)"/>
            {/* 블록 하단 경계 실선 */}
            <line x1={sx} y1={aY} x2={sx + sw} y2={aY}
              stroke={INK} strokeWidth="1.2"/>

            {/* 0.85f'c 응력 레이블 (블록 내, 중앙) */}
            {aPx > 14 && (
              <text x={sx + sw / 2} y={sy + aPx / 2 + 4}
                textAnchor="middle" fontSize="8" fontFamily={mono} fill={INK} fontWeight="700">
                0.85f'c
              </text>
            )}

            {/* 중립축 점선 */}
            <line x1={sx} y1={cY} x2={sx + sw} y2={cY}
              stroke={INK} strokeWidth="0.85" strokeDasharray="5 3"/>

            {/* 철근 중심 점선 */}
            <line x1={sx} y1={dY} x2={sx + sw} y2={dY}
              stroke={INK2} strokeWidth="0.6" strokeDasharray="3 2"/>

            {/* ── 압축 합력 C ← (오른쪽에서 단면 방향으로) ── */}
            {(() => {
              const tipX = sx + sw
              const tailX = tipX + ALEN
              const AH = 6, AW = 4
              return (
                <g>
                  <line x1={tailX} y1={CY} x2={tipX + AH} y2={CY}
                    stroke={INK} strokeWidth="1.8"/>
                  <polygon points={`${tipX},${CY} ${tipX+AH},${CY-AW} ${tipX+AH},${CY+AW}`}
                    fill={INK}/>
                  {/* C 레이블 */}
                  <text x={tailX + 4} y={CY - 3}
                    fontSize="10" fontFamily={mono} fill={INK} fontWeight="800" fontStyle="italic">
                    C
                  </text>
                  {/* C = 0.85f'c·b·a */}
                  <text x={tailX + 4} y={CY + 9}
                    fontSize="7" fontFamily={mono} fill={INK2}>
                    =0.85f'c·b·a
                  </text>
                  <text x={tailX + 4} y={CY + 18}
                    fontSize="7" fontFamily={mono} fill={INK2}>
                    ={fi(Cc)} kN
                  </text>
                </g>
              )
            })()}

            {/* ── 인장 합력 T → (왼쪽에서 단면 방향으로) ── */}
            {(() => {
              const tipX = sx
              const tailX = tipX - ALEN
              const AH = 6, AW = 4
              return (
                <g>
                  <line x1={tailX} y1={TY} x2={tipX - AH} y2={TY}
                    stroke={INK} strokeWidth="1.8"/>
                  <polygon points={`${tipX},${TY} ${tipX-AH},${TY-AW} ${tipX-AH},${TY+AW}`}
                    fill={INK}/>
                  {/* T 레이블 */}
                  <text x={tailX - 4} y={TY - 3}
                    fontSize="10" fontFamily={mono} fill={INK} fontWeight="800"
                    fontStyle="italic" textAnchor="end">
                    T
                  </text>
                  {/* T = As·fy */}
                  <text x={tailX - 4} y={TY + 9}
                    fontSize="7" fontFamily={mono} fill={INK2} textAnchor="end">
                    =As·fy
                  </text>
                  <text x={tailX - 4} y={TY + 18}
                    fontSize="7" fontFamily={mono} fill={INK2} textAnchor="end">
                    ={fi(Ts)} kN
                  </text>
                </g>
              )
            })()}

            {/* ── C = T 평형 표기 (단면 하단) ── */}
            <text x={sx + sw / 2} y={sy + drawH - 5}
              textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">
              C = T
            </text>

            {/* ── a 치수선 (왼쪽) ── */}
            <VDim x={aXL} y1={sy} y2={aY} label="a" side="left"
              extL={sx}/>

            {/* ── c 치수선 (왼쪽, a 아래) ── */}
            <VDim x={aXL} y1={sy} y2={cY} label="" side="left"/>
            {/* c 레이블을 a 치수선 왼쪽에 작게 */}
            <text x={aXL - 4} y={(sy + cY) / 2 + 4}
              fontSize="8" fontFamily={mono} fill={INK2} textAnchor="end"
              fontWeight="600">
              c
            </text>

            {/* ── a = β₁·c 관계식 ── */}
            <text x={aXL - 4} y={aY + 11}
              fontSize="7" fontFamily={mono} fill={INK2} textAnchor="end">
              a=β₁c={f1(beta1)}·{f1(c)}
            </text>

            {/* ── d 치수선 (오른쪽 1열) ── */}
            <VDim x={dXR} y1={sy} y2={dY} label="d" side="right"
              extR={sx + sw}/>

            {/* ── z = d − a/2 치수선 (오른쪽 2열) ── */}
            {(() => {
              const AH = 5, AW = 3.5
              return (
                <g>
                  {/* 연장선: CY, TY → zXR */}
                  <line x1={sx + sw} y1={CY} x2={zXR - 1} y2={CY}
                    stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  <line x1={sx + sw} y1={TY} x2={zXR - 1} y2={TY}
                    stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  {/* 수직선 */}
                  {TY - CY > AH * 2 + 2 && (
                    <>
                      <line x1={zXR} y1={CY + AH} x2={zXR} y2={TY - AH}
                        stroke={INK} strokeWidth="0.9"/>
                      <polygon points={`${zXR},${CY} ${zXR-AW},${CY+AH} ${zXR+AW},${CY+AH}`} fill={INK}/>
                      <polygon points={`${zXR},${TY} ${zXR-AW},${TY-AH} ${zXR+AW},${TY-AH}`} fill={INK}/>
                    </>
                  )}
                  {/* z 레이블 */}
                  <text x={zXR + 4} y={(CY + TY) / 2 + 4}
                    fontSize="9" fontFamily={mono} fill={INK} fontWeight="800">
                    z
                  </text>
                  <text x={zXR + 4} y={(CY + TY) / 2 + 14}
                    fontSize="7" fontFamily={mono} fill={INK2}>
                    ={f1(z)}
                  </text>
                  {/* z = d - a/2 수식 */}
                  <text x={zXR + 4} y={(CY + TY) / 2 + 23}
                    fontSize="6.5" fontFamily={mono} fill={INK2}>
                    =d-a/2
                  </text>
                </g>
              )
            })()}

            {/* ── 열 제목 ── */}
            <text x={sx + sw / 2} y={height - 5}
              textAnchor="middle" fontSize="9" fontFamily={mono} fill={INK} fontWeight="800">
              Stress Block &amp; Forces
            </text>
          </g>
        )
      })()}
    </svg>
  )
}
