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
// Strain Diagram + Forces & Moment Arms  (흑백 교재 스타일)
// 이미지 참조: εcu=0.003 삼각형 변형률도 / 등가응력블록 힘 다이어그램
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
  width = 340, height = 210,
}: StrainForceProps) {
  const mono = 'JetBrains Mono, Consolas, monospace'

  // 절반 너비 (strain 다이어그램 / forces 다이어그램)
  const half = width / 2
  const BG = '#ffffff'
  const INK = '#1a1a1a'        // 주 선색
  const INK2 = '#444444'       // 보조 텍스트
  const HATCH = '#cccccc'      // 해칭

  // ── 공통 단면 스케일 ──────────────────────────────────────
  // 세로 방향은 height - pad 로 맞춤
  const padT = 28, padB = 22
  const drawH = height - padT - padB

  // 각 패널 x 오프셋
  const sOx = 10   // strain panel: section 좌상단 x
  const fOx = half + 12 // force panel: section 좌상단 x

  // 단면 폭 픽셀 (두 패널 공용, 비율 유지)
  const secW = 44  // section 폭 픽셀 (고정 slim)
  const scale = drawH / h

  const cPx  = c * scale   // 중립축 픽셀
  const aPx  = a * scale   // 응력블록 픽셀
  const dPx  = d * scale   // 유효깊이 픽셀

  // ── fmt ──────────────────────────────────────────────────
  const f2 = (v: number) => v.toFixed(2)
  const f4 = (v: number) => v.toFixed(4)

  // 힘 크기 (kN)
  const Cc = 0.85 * fck * a * b * 1e-3  // kN
  const Ts = As * fy * 1e-3              // kN

  // ════════════════════════════════════════════════════════
  // ① Strain Diagram  (좌측 패널)
  // ════════════════════════════════════════════════════════
  // 단면 사각형 위치
  const sSecX = sOx + 36   // 단면 좌측 x
  const sSecY = padT        // 단면 상단 y
  // 변형률 다이어그램 위치 (단면 왼쪽)
  const sDiaX = sOx + 2    // 변형률 다이어그램 x 중심
  const sDiaW = 28          // 너비

  // 중립축 y 픽셀 (패널 내)
  const sCy = sSecY + cPx  // 중립축 y
  const sDy = sSecY + dPx  // 유효깊이 y

  // 변형률 다이어그램 꼭짓점:
  //   상단: εcu = 0.003  → 최대값
  //   중립축: 0
  //   하단(d): εt
  // 선형이므로 x 폭을 변형률에 비례
  const strainMax = Math.max(0.003, Math.abs(Et)) * 1.05
  const toStrainX = (eps: number) => sDiaX + sDiaW * Math.abs(eps) / strainMax

  // 꼭짓점
  const topX   = toStrainX(0.003)

  const botX   = toStrainX(Et)

  // ════════════════════════════════════════════════════════
  // ② Forces & Moment Arms 다이어그램 (우측 패널)
  // ════════════════════════════════════════════════════════
  const fSecX = fOx + 4    // 단면 좌측 x
  const fSecY = padT        // 단면 상단 y

  // 단면 우측 x
  const fSecR = fSecX + secW

  // 등가 응력블록 해칭 (상단 a 깊이)
  const fABot = fSecY + aPx  // 응력블록 하단 y

  // Cs 위치 (압축 합력) : a/2 위치
  const fCsY = fSecY + aPx / 2
  // Ts 위치 (인장 합력) : d 위치
  const fTsY = fSecY + dPx

  // 오른쪽 치수선 x 좌표들
  const rDim1 = fSecR + 12  // 1열
  const rDim2 = fSecR + 26  // 2열

  // 아암 길이 = d - a/2
  // armPx = d - a/2 (모멘트 팔): jd 치수선에서 사용
  const _armPx = dPx - aPx / 2
  void _armPx

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%"
      style={{ display: 'block', background: BG }}>
      <defs>
        {/* 수직 해칭 (Forces 다이어그램 압축블록용) */}
        <pattern id="sfHatch" x="0" y="0" width="4" height="4"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke={HATCH} strokeWidth="0.8"/>
        </pattern>
        {/* 화살표 마커 — 흑백 */}
        <marker id="sfArU" markerWidth="5" markerHeight="6" refX="2.5" refY="0" orient="auto">
          <path d="M0,6 L2.5,0 L5,6 Z" fill={INK}/>
        </marker>
        <marker id="sfArD" markerWidth="5" markerHeight="6" refX="2.5" refY="6" orient="auto">
          <path d="M0,0 L2.5,6 L5,0 Z" fill={INK}/>
        </marker>
        <marker id="sfArL" markerWidth="6" markerHeight="5" refX="0" refY="2.5" orient="auto">
          <path d="M6,0 L0,2.5 L6,5 Z" fill={INK}/>
        </marker>
        <marker id="sfArR" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
          <path d="M0,0 L6,2.5 L0,5 Z" fill={INK}/>
        </marker>
        <marker id="sfArUD0" markerWidth="5" markerHeight="6" refX="2.5" refY="0" orient="auto">
          <path d="M0,6 L2.5,0 L5,6 Z" fill={INK2}/>
        </marker>
        <marker id="sfArUD1" markerWidth="5" markerHeight="6" refX="2.5" refY="6" orient="auto">
          <path d="M0,0 L2.5,6 L5,0 Z" fill={INK2}/>
        </marker>
      </defs>

      {/* ── 배경 흰색 ── */}
      <rect width={width} height={height} fill={BG}/>

      {/* ══════════════════════════════════════════════════
          패널 ①  Strain Diagram
      ══════════════════════════════════════════════════ */}

      {/* 단면 외곽 (slim) */}
      <rect x={sSecX} y={sSecY} width={secW} height={drawH}
        fill="none" stroke={INK} strokeWidth="1.4"/>

      {/* 중립축 수평선 */}
      <line x1={sSecX} y1={sCy} x2={sSecX + secW} y2={sCy}
        stroke={INK} strokeWidth="0.8" strokeDasharray="3 2"/>

      {/* 변형률 다이어그램 삼각형 꼴 — 단면 왼쪽에 붙어서 그림 */}
      {/* 상단 → 중립축: 압축측 (좌→우로 양수) */}
      <polygon
        points={`${sSecX},${sSecY} ${topX},${sSecY} ${sSecX},${sCy}`}
        fill="#e0e0e0" stroke={INK} strokeWidth="1.0" strokeLinejoin="round"/>
      {/* 중립축 → 하단(d): 인장측 */}
      <polygon
        points={`${sSecX},${sCy} ${botX},${sDy} ${sSecX},${sDy}`}
        fill="#f0f0f0" stroke={INK} strokeWidth="1.0" strokeLinejoin="round"/>

      {/* εcu = 0.003 레이블 (상단) */}
      <text x={sSecX + secW / 2} y={sSecY - 6}
        textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="600">
        ε<tspan fontSize="6" dy="1">cu</tspan>
        <tspan dy="-1"> = 0.003</tspan>
      </text>

      {/* εt 레이블 (하단, 인장변형률) */}
      <text x={sSecX + secW / 2 + 2} y={sDy + 12}
        textAnchor="middle" fontSize="7" fontFamily={mono} fill={INK}>
        ε<tspan fontSize="6" dy="1">t</tspan>
        <tspan dy="-1"> = {f4(Et)}</tspan>
      </text>
      {/* εy 비교 표기 */}
      {Et < 0.005 && (
        <text x={sSecX + secW / 2 + 2} y={sDy + 21}
          textAnchor="middle" fontSize="6.5" fontFamily={mono} fill={INK2}>
          ({Et >= Ey ? '≥' : '<'} ε<tspan fontSize="5.5" dy="0.8">y</tspan><tspan dy="-0.8">)</tspan>
        </text>
      )}
      {Et >= 0.005 && (
        <text x={sSecX + secW / 2 + 2} y={sDy + 21}
          textAnchor="middle" fontSize="6.5" fontFamily={mono} fill={INK2}>
          (인장지배)
        </text>
      )}

      {/* c 치수선 (단면 우측) */}
      {c > 0 && (() => {
        const lx = sSecX + secW + 8
        return (
          <>
            <line x1={sSecX + secW} y1={sSecY} x2={lx + 2} y2={sSecY}
              stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
            <line x1={sSecX + secW} y1={sCy}   x2={lx + 2} y2={sCy}
              stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
            <line x1={lx} y1={sSecY} x2={lx} y2={sCy}
              stroke={INK} strokeWidth="0.9"
              markerStart="url(#sfArUD0)" markerEnd="url(#sfArUD1)"/>
            <text x={lx + 3} y={(sSecY + sCy) / 2 + 3}
              fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">
              c={f2(c)}
            </text>
          </>
        )
      })()}

      {/* ε'_s 기울기 표기 (중립축 위, 단면 내부 대각선 방향 레이블) */}
      <text x={sSecX + 6} y={sCy - cPx * 0.45}
        fontSize="7" fontFamily={mono} fill={INK} fontStyle="italic">
        ε'<tspan fontSize="5.5" dy="1">s</tspan>
      </text>

      {/* 패널 제목 */}
      <text x={sSecX + secW / 2} y={height - 4}
        textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK2} fontWeight="600">
        Strain Diagram
      </text>

      {/* ══════════════════════════════════════════════════
          패널 ②  Forces & Moment Arms
      ══════════════════════════════════════════════════ */}

      {/* 단면 외곽 */}
      <rect x={fSecX} y={fSecY} width={secW} height={drawH}
        fill="none" stroke={INK} strokeWidth="1.4"/>

      {/* 압축 응력블록 해칭 (상단 a 깊이) */}
      <rect x={fSecX} y={fSecY} width={secW} height={aPx}
        fill="url(#sfHatch)" stroke="none"/>
      {/* 응력블록 하단 경계선 */}
      <line x1={fSecX} y1={fABot} x2={fSecX + secW} y2={fABot}
        stroke={INK} strokeWidth="0.9" strokeDasharray="3 2"/>

      {/* a 치수선 (왼쪽) */}
      {(() => {
        const lx = fSecX - 10
        return (
          <>
            <line x1={fSecX} y1={fSecY}  x2={lx - 2} y2={fSecY}
              stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
            <line x1={fSecX} y1={fABot}  x2={lx - 2} y2={fABot}
              stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
            <line x1={lx} y1={fSecY} x2={lx} y2={fABot}
              stroke={INK} strokeWidth="0.9"
              markerStart="url(#sfArUD0)" markerEnd="url(#sfArUD1)"/>
            <text x={lx - 2} y={(fSecY + fABot) / 2 + 3}
              fontSize="7" fontFamily={mono} fill={INK} textAnchor="end" fontWeight="700">
              a={f2(a)}
            </text>
          </>
        )
      })()}

      {/* Cs 압축 합력 화살표 (단면 우측 → 좌, 수평) */}
      <line x1={fSecR + 22} y1={fCsY} x2={fSecR + 2} y2={fCsY}
        stroke={INK} strokeWidth="1.4" markerEnd="url(#sfArL)"/>
      <text x={fSecR + 25} y={fCsY + 4}
        fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">C<tspan fontSize="6" dy="1">s</tspan>
      </text>
      <text x={fSecR + 25} y={fCsY + 13}
        fontSize="6.5" fontFamily={mono} fill={INK2}>
        {Math.round(Cc)}kN
      </text>

      {/* Cc 레이블 (응력블록 중심) */}
      <text x={fSecX + secW / 2} y={fSecY + aPx / 2 + 4}
        textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700">
        C<tspan fontSize="6" dy="1">C</tspan>
      </text>

      {/* d 치수선 (우측 1열) */}
      {(() => {
        return (
          <>
            <line x1={fSecR} y1={fSecY} x2={rDim1 + 2} y2={fSecY}
              stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
            <line x1={fSecR} y1={fTsY}  x2={rDim1 + 2} y2={fTsY}
              stroke={INK2} strokeWidth="0.4" strokeDasharray="2 1.5"/>
            <line x1={rDim1} y1={fSecY} x2={rDim1} y2={fTsY}
              stroke={INK} strokeWidth="0.9"
              markerStart="url(#sfArUD0)" markerEnd="url(#sfArUD1)"/>
            <text x={rDim1 + 3} y={(fSecY + fTsY) / 2 + 3}
              fontSize="7" fontFamily={mono} fill={INK} fontWeight="700">d</text>
          </>
        )
      })()}

      {/* 모멘트 팔 (d - a/2) 치수선 (우측 2열) */}
      {(() => {
        return (
          <>
            <line x1={fSecR} y1={fCsY}  x2={rDim2 + 2} y2={fCsY}
              stroke={INK2} strokeWidth="0.35" strokeDasharray="2 1.5"/>
            <line x1={fSecR} y1={fTsY}  x2={rDim2 + 2} y2={fTsY}
              stroke={INK2} strokeWidth="0.35" strokeDasharray="2 1.5"/>
            <line x1={rDim2} y1={fCsY} x2={rDim2} y2={fTsY}
              stroke={INK} strokeWidth="0.9"
              markerStart="url(#sfArUD0)" markerEnd="url(#sfArUD1)"/>
            <text x={rDim2 + 3} y={(fCsY + fTsY) / 2 + 3}
              fontSize="6.5" fontFamily={mono} fill={INK2}>jd</text>
          </>
        )
      })()}

      {/* Ts 인장 합력 화살표 (단면 우측 ← 좌, 수평 반대) */}
      <line x1={fSecX - 2} y1={fTsY} x2={fSecX - 22} y2={fTsY}
        stroke={INK} strokeWidth="1.4" markerEnd="url(#sfArL)"/>
      <text x={fSecX - 24} y={fTsY - 3}
        fontSize="7.5" fontFamily={mono} fill={INK} fontWeight="700" textAnchor="end">
        T<tspan fontSize="6" dy="1">s</tspan>
      </text>
      <text x={fSecX - 24} y={fTsY + 9}
        fontSize="6.5" fontFamily={mono} fill={INK2} textAnchor="end">
        {Math.round(Ts)}kN
      </text>

      {/* 중립축 점선 */}
      <line x1={fSecX} y1={fSecY + cPx} x2={fSecX + secW} y2={fSecY + cPx}
        stroke={INK} strokeWidth="0.7" strokeDasharray="3 2"/>

      {/* 패널 제목 */}
      <text x={fSecX + secW / 2} y={height - 4}
        textAnchor="middle" fontSize="7.5" fontFamily={mono} fill={INK2} fontWeight="600">
        Forces &amp; Moment Arms
      </text>

      {/* ── 구분선 (중앙) ── */}
      <line x1={half} y1={padT - 8} x2={half} y2={height - padB + 4}
        stroke="#cccccc" strokeWidth="0.7" strokeDasharray="3 2"/>
    </svg>
  )
}
