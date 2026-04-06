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
  width = 340, height = 200,
}: StrainForceProps) {
  const mono = 'JetBrains Mono, Consolas, monospace'

  // ── 색상 (흑백 기술도면) ─────────────────────────────────
  const INK    = '#111111'   // 주 선/텍스트
  const INK2   = '#555555'   // 보조 텍스트/치수선
  const FILL_C = '#d8d8d8'   // 압축측 해칭 배경
  const FILL_T = '#f0f0f0'   // 인장측 변형률 영역

  // ── 레이아웃 상수 ────────────────────────────────────────
  // 전체를 3열로 분할: [단면] [변형률도] [응력블록+합력]
  // 각 열 너비 배분 (width=340 기준)
  const padT = 22   // 상단 여백 (레이블용)
  const padB = 18   // 하단 여백 (제목용)
  const drawH = height - padT - padB

  // 단면 aspect ratio 반영: b:h 비율로 단면 폭 결정
  // b=1000, h=560 → 약 1.79:1 → 단면 폭을 drawH/h * b 로 계산하되 최대 80px
  const rawSecW = drawH * (b / h)
  const secW = Math.min(rawSecW, 76)   // 단면 폭 픽셀 (비율 반영, 최대 76)

  // 3열 x 기준점
  // col1: 단면 (왼쪽 치수선 포함)
  // col2: 변형률 다이어그램
  // col3: 응력블록 + 합력 다이어그램
  const col1X  = 20              // 단면 좌측 x (h 치수선 여백 후)
  const gap    = (width - col1X - secW * 3 - 30) / 2  // 열 간격
  const col2X  = col1X + secW + Math.max(gap, 8)       // 변형률 다이어그램 좌측 x
  const col3X  = col2X + secW + Math.max(gap, 8)       // 응력블록 다이어그램 좌측 x

  const secY   = padT       // 모든 단면 상단 y (동일 기준선)
  const scaleY = drawH / h  // mm → px 변환

  // 주요 y 좌표 (px, 단면 상단 기준)
  const cPx  = c * scaleY   // 중립축
  const aPx  = a * scaleY   // 응력블록 하단
  const dPx  = d * scaleY   // 유효깊이 (철근 중심)

  // ── 힘 계산 ──────────────────────────────────────────────
  const Cc = 0.85 * fck * a * b * 1e-3   // 압축 합력 (kN)
  const Ts = As * fy * 1e-3               // 인장 합력 (kN)
  const z  = d - a / 2                    // 모멘트 팔 (mm)

  // ── 텍스트 포맷 ──────────────────────────────────────────
  const f1  = (v: number) => v.toFixed(1)
  const f3  = (v: number) => v.toFixed(3)
  const f4e = (v: number) => v.toFixed(4)

  // ── 마커 id (전역 충돌 방지용 prefix) ───────────────────
  const M = 'sfd'  // prefix

  // ── 화살촉 헬퍼 (단순 채움 삼각형) ─────────────────────
  // orient: 'up'|'down'|'left'|'right'
  // 치수선용 양방향 화살표: markerStart/End 에 사용
  // 합력 화살표: 별도 polygon으로 직접 그림

  // ── 치수선 헬퍼 ─────────────────────────────────────────
  // 수직 치수선 (x 고정, y1~y2, 레이블은 우측)
  const VDim = ({
    x, y1, y2, label, labelSide = 'right', ext = true,
    col1Ref, col2Ref,
  }: {
    x: number; y1: number; y2: number; label: string
    labelSide?: 'right' | 'left'; ext?: boolean
    col1Ref?: number; col2Ref?: number  // 연장선 출발 x
  }) => {
    const arrowH = 5, arrowW = 3
    const mid = (y1 + y2) / 2
    const dir = y2 > y1 ? 1 : -1
    const lx = labelSide === 'right' ? x + 3 : x - 3
    return (
      <g>
        {/* 연장선 */}
        {ext && col1Ref !== undefined && (
          <line x1={col1Ref} y1={y1} x2={x} y2={y1} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
        )}
        {ext && col2Ref !== undefined && (
          <line x1={col2Ref} y1={y1} x2={x} y2={y1} stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
        )}
        {/* 수직선 */}
        <line x1={x} y1={y1 + arrowH * dir} x2={x} y2={y2 - arrowH * dir}
          stroke={INK} strokeWidth="0.9"/>
        {/* 화살촉 상단 */}
        <polygon points={`${x},${y1} ${x - arrowW},${y1 + arrowH * dir} ${x + arrowW},${y1 + arrowH * dir}`}
          fill={INK}/>
        {/* 화살촉 하단 */}
        <polygon points={`${x},${y2} ${x - arrowW},${y2 - arrowH * dir} ${x + arrowW},${y2 - arrowH * dir}`}
          fill={INK}/>
        {/* 레이블 */}
        <text x={lx} y={mid + 3.5}
          fontSize="8" fontFamily={mono} fill={INK} fontWeight="700"
          textAnchor={labelSide === 'right' ? 'start' : 'end'}>
          {label}
        </text>
      </g>
    )
  }

  // 수평 합력 화살표 (→ 또는 ←)
  const ForceArrow = ({
    x1, x2, y, label, subLabel, side,
  }: {
    x1: number; x2: number; y: number
    label: string; subLabel?: string; side: 'right' | 'left'
  }) => {
    const arrowW = 6, arrowH = 3.5
    // x2가 화살 끝(촉), x1이 시작
    const isRight = x2 > x1
    const tipX = x2
    const baseX = isRight ? x2 - arrowW : x2 + arrowW
    const lx = side === 'right' ? Math.max(x1, x2) + 4 : Math.min(x1, x2) - 4
    return (
      <g>
        <line x1={x1} y1={y} x2={baseX} y2={y} stroke={INK} strokeWidth="1.5"/>
        <polygon points={`${tipX},${y} ${baseX},${y - arrowH} ${baseX},${y + arrowH}`} fill={INK}/>
        <text x={lx} y={y - 2} fontSize="8.5" fontFamily={mono} fill={INK} fontWeight="800"
          textAnchor={side === 'right' ? 'start' : 'end'} fontStyle="italic">
          {label}
        </text>
        {subLabel && (
          <text x={lx} y={y + 9} fontSize="7" fontFamily={mono} fill={INK2}
            textAnchor={side === 'right' ? 'start' : 'end'}>
            {subLabel}
          </text>
        )}
      </g>
    )
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
      style={{ display: 'block', background: '#ffffff' }}
      id={`${M}-svg`}>
      <defs>
        {/* 45° 해칭 — 압축측 채움 */}
        <pattern id={`${M}-hatch`} x="0" y="0" width="5" height="5"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={FILL_C}/>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#aaaaaa" strokeWidth="0.7"/>
        </pattern>
        {/* 단면 전체 콘크리트 채움 (연한 회색) */}
        <pattern id={`${M}-conc`} x="0" y="0" width="6" height="6"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#ebebeb"/>
          <line x1="0" y1="0" x2="0" y2="6" stroke="#d0d0d0" strokeWidth="0.5"/>
        </pattern>
      </defs>

      {/* ════════════════════════════════════════════════════
          열 ①  Cross Section
      ════════════════════════════════════════════════════ */}
      {(() => {
        const sx = col1X, sy = secY
        const sw = secW, sh = drawH

        // 철근 표현 (단면 하부, 균등 배치 5개 표시)
        const nBars  = 5       // 표시 개수 (심볼릭, 실제 수 무관)
        const barR   = Math.max(sw * 0.045, 2.8)
        const coverPx = Math.max(sh * 0.06, 5)
        const barY   = sy + dPx
        const spacing = (sw - coverPx * 2) / (nBars - 1)

        return (
          <g>
            {/* 콘크리트 단면 */}
            <rect x={sx} y={sy} width={sw} height={sh}
              fill={`url(#${M}-conc)`} stroke={INK} strokeWidth="1.6"/>

            {/* 중립축 점선 */}
            <line x1={sx} y1={sy + cPx} x2={sx + sw} y2={sy + cPx}
              stroke={INK} strokeWidth="0.8" strokeDasharray="4 2.5"/>
            {/* N.A 레이블 */}
            <text x={sx + sw + 2} y={sy + cPx + 3.5}
              fontSize="6.5" fontFamily={mono} fill={INK2}>N.A</text>

            {/* 유효깊이 d 점선 */}
            <line x1={sx} y1={sy + dPx} x2={sx + sw} y2={sy + dPx}
              stroke={INK2} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.7"/>

            {/* 철근 (검은 원) */}
            {Array.from({ length: nBars }, (_, i) => {
              const bx = sx + coverPx + i * spacing
              return (
                <circle key={i} cx={bx} cy={barY} r={barR}
                  fill={INK} stroke={INK} strokeWidth="0.5"/>
              )
            })}

            {/* h 치수선 (단면 좌측) */}
            <VDim x={sx - 12} y1={sy} y2={sy + sh}
              label={`h=${h}`} labelSide="left" ext={false}/>

            {/* d 치수선 (단면 우측 — 압축연단~철근중심) */}
            <VDim x={sx + sw + 12} y1={sy} y2={sy + dPx}
              label="d" labelSide="right" ext={false}/>

            {/* (h-d) 치수선 (철근 중심~하단) */}
            <VDim x={sx + sw + 12} y1={sy + dPx} y2={sy + sh}
              label="" labelSide="right" ext={false}/>

            {/* b 치수선 (단면 하단) */}
            {(() => {
              const by = sy + sh + 12
              const aw = 4, ah = 3
              return (
                <g>
                  <line x1={sx} y1={sy + sh} x2={sx} y2={by + 2}
                    stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  <line x1={sx + sw} y1={sy + sh} x2={sx + sw} y2={by + 2}
                    stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  <line x1={sx + aw} y1={by} x2={sx + sw - aw} y2={by}
                    stroke={INK} strokeWidth="0.9"/>
                  <polygon points={`${sx},${by} ${sx + aw},${by - ah} ${sx + aw},${by + ah}`} fill={INK}/>
                  <polygon points={`${sx + sw},${by} ${sx + sw - aw},${by - ah} ${sx + sw - aw},${by + ah}`} fill={INK}/>
                  <text x={sx + sw / 2} y={by + 10}
                    textAnchor="middle" fontSize="8" fontFamily={mono} fill={INK} fontWeight="700">
                    b={b}
                  </text>
                </g>
              )
            })()}

            {/* 열 제목 */}
            <text x={sx + sw / 2} y={height - 4}
              textAnchor="middle" fontSize="7" fontFamily={mono} fill={INK2} fontWeight="600">
              Section
            </text>
          </g>
        )
      })()}

      {/* ════════════════════════════════════════════════════
          열 ②  Strain Diagram
      ════════════════════════════════════════════════════ */}
      {(() => {
        const sx = col2X, sy = secY
        const sw = secW

        // 변형률 최대값 (스케일 기준)
        const eMax  = Math.max(0.003, Math.abs(Et)) * 1.15
        const toEx  = (e: number) => sw * Math.abs(e) / eMax

        // 변형률 다이어그램 꼭짓점
        // 압축측: 상단 εcu=0.003 (오른쪽), 중립축에서 0 (왼쪽)
        // 인장측: 중립축 0 (왼쪽), 하단 d에서 εt (오른쪽)
        const eCuX  = sx + toEx(0.003)   // 상단 오른쪽
        const eTX   = sx + toEx(Et)      // 하단(d) 오른쪽
        const cY    = sy + cPx
        const dY    = sy + dPx

        return (
          <g>
            {/* 단면 외곽선만 (채움 없음) */}
            <rect x={sx} y={sy} width={sw} height={drawH}
              fill="none" stroke={INK} strokeWidth="1.4"/>

            {/* 압축측 삼각형 (해칭) */}
            <polygon
              points={`${sx},${sy} ${eCuX},${sy} ${sx},${cY}`}
              fill={FILL_C} stroke={INK} strokeWidth="0.9"/>

            {/* 인장측 삼각형 */}
            <polygon
              points={`${sx},${cY} ${eTX},${dY} ${sx},${dY}`}
              fill={FILL_T} stroke={INK} strokeWidth="0.9"/>

            {/* 0-line (중립축) */}
            <line x1={sx} y1={cY} x2={sx + sw} y2={cY}
              stroke={INK} strokeWidth="0.8" strokeDasharray="4 2.5"/>

            {/* εcu = 0.003 레이블 (상단) */}
            <text x={sx + sw / 2} y={sy - 6}
              textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">
              ε<tspan baselineShift="sub" fontSize="6">cu</tspan> = 0.003
            </text>

            {/* 중립축 c 레이블 — 좌측 */}
            <text x={sx - 3} y={cY + 3.5}
              fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700" textAnchor="end">
              c={f1(c)}
            </text>

            {/* 수직 기준선 (왼쪽 0-축) */}
            <line x1={sx} y1={sy} x2={sx} y2={sy + drawH}
              stroke={INK} strokeWidth="1.4"/>

            {/* εt 레이블 (하단) */}
            <text x={sx + sw / 2} y={dY + 11}
              textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">
              ε<tspan baselineShift="sub" fontSize="6">t</tspan>={f3(Et)}
            </text>

            {/* 인장지배 여부 */}
            <text x={sx + sw / 2} y={dY + 20}
              textAnchor="middle" fontSize="6.5" fontFamily={mono} fill={INK2}>
              {Et >= 0.005
                ? '(tension-controlled)'
                : Et >= Ey
                ? `(≥ εy=${f4e(Ey)})`
                : `(< εy=${f4e(Ey)})`}
            </text>

            {/* d 수평점선 */}
            <line x1={sx} y1={dY} x2={sx + sw} y2={dY}
              stroke={INK2} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.7"/>

            {/* c 치수선 (우측) */}
            <VDim x={sx + sw + 10} y1={sy} y2={cY}
              label="c" labelSide="right" ext={false}/>

            {/* 열 제목 */}
            <text x={sx + sw / 2} y={height - 4}
              textAnchor="middle" fontSize="7" fontFamily={mono} fill={INK2} fontWeight="600">
              Strain Diagram
            </text>
          </g>
        )
      })()}

      {/* ════════════════════════════════════════════════════
          열 ③  Stress Block & Forces
      ════════════════════════════════════════════════════ */}
      {(() => {
        const sx = col3X, sy = secY
        const sw = secW

        const cY  = sy + cPx
        const aY  = sy + aPx   // 응력블록 하단
        const dY  = sy + dPx   // 철근 중심
        const CY  = sy + aPx / 2   // 압축 합력 작용점 (a/2)
        const TY  = dY             // 인장 합력 작용점 (d)

        // 합력 화살표 길이
        const arrowLen = Math.min(sw * 0.55, 28)

        return (
          <g>
            {/* 단면 외곽 */}
            <rect x={sx} y={sy} width={sw} height={drawH}
              fill="none" stroke={INK} strokeWidth="1.4"/>

            {/* 압축블록 해칭 (상단 ~ a) */}
            <rect x={sx} y={sy} width={sw} height={aPx}
              fill={`url(#${M}-hatch)`} stroke="none"/>
            {/* 응력블록 하단 경계 (실선) */}
            <line x1={sx} y1={aY} x2={sx + sw} y2={aY}
              stroke={INK} strokeWidth="1.1"/>

            {/* 응력 레이블 (블록 내) */}
            <text x={sx + sw / 2} y={sy + aPx / 2 + 3.5}
              textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">
              0.85f'c
            </text>

            {/* 중립축 점선 */}
            <line x1={sx} y1={cY} x2={sx + sw} y2={cY}
              stroke={INK} strokeWidth="0.8" strokeDasharray="4 2.5"/>

            {/* 유효깊이 점선 */}
            <line x1={sx} y1={dY} x2={sx + sw} y2={dY}
              stroke={INK2} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.7"/>

            {/* ── 압축 합력 C (→ 방향, 오른쪽에서 들어옴) ── */}
            <ForceArrow
              x1={sx + sw + arrowLen} x2={sx + sw} y={CY}
              label="C" subLabel={`${Math.round(Cc)} kN`}
              side="right"/>

            {/* ── 인장 합력 T (← 방향, 왼쪽에서 들어옴) ── */}
            <ForceArrow
              x1={sx - arrowLen} x2={sx} y={TY}
              label="T" subLabel={`${Math.round(Ts)} kN`}
              side="left"/>

            {/* ── 치수선 열 (단면 우측) ── */}
            {/* d : 압축연단 ~ 철근중심 */}
            <VDim x={sx + sw + arrowLen + 16} y1={sy} y2={dY}
              label="d" labelSide="right" ext={false}/>

            {/* a : 압축연단 ~ 블록 하단 */}
            <VDim x={sx - arrowLen - 16} y1={sy} y2={aY}
              label="a" labelSide="left" ext={false}/>

            {/* z = d - a/2 : 모멘트 팔 */}
            {(() => {
              const zx  = sx + sw + arrowLen + 28
              const aw  = 4, ah = 2.5
              // 두 점 (CY, TY) 사이 양방향 화살표
              return (
                <g>
                  <line x1={sx + sw} y1={CY} x2={zx - 2} y2={CY}
                    stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  <line x1={sx + sw} y1={TY} x2={zx - 2} y2={TY}
                    stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
                  {/* 수직선 */}
                  <line x1={zx} y1={CY + aw} x2={zx} y2={TY - aw}
                    stroke={INK} strokeWidth="0.9"/>
                  <polygon points={`${zx},${CY} ${zx - ah},${CY + aw} ${zx + ah},${CY + aw}`} fill={INK}/>
                  <polygon points={`${zx},${TY} ${zx - ah},${TY - aw} ${zx + ah},${TY - aw}`} fill={INK}/>
                  <text x={zx + 3} y={(CY + TY) / 2 + 3.5}
                    fontSize="8" fontFamily={mono} fill={INK} fontWeight="700">
                    z={f1(z)}
                  </text>
                </g>
              )
            })()}

            {/* 열 제목 */}
            <text x={sx + sw / 2} y={height - 4}
              textAnchor="middle" fontSize="7" fontFamily={mono} fill={INK2} fontWeight="600">
              Forces &amp; Moment Arms
            </text>
          </g>
        )
      })()}
    </svg>
  )
}
