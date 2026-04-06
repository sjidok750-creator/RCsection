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
  Et: number      // 인장변형률 εt
  width?: number
  height?: number
}

export function StrainForceDiagram({
  b, h, d, c, a, As,
  Et,
  width = 620, height = 520,
}: StrainForceProps) {
  // ── 폰트 / 색상 ────────────────────────────────────────────
  const serif = 'Times New Roman, Georgia, serif'
  const INK   = '#111111'
  const INK2  = '#444444'
  const GREY  = '#bbbbbb'

  // ══════════════════════════════════════════════════════════
  // 레이아웃: width=620, height=520
  //   titleH  : 제목 영역 높이
  //   topH    : 상단 행 (Strain | 세로단면)
  //   botH    : 하단 행 (광폭 가로 단면)
  // ══════════════════════════════════════════════════════════
  const W = width, H = height
  const titleH = 46   // 제목 2줄
  const divH   = 8    // 행 사이 간격
  const topH   = Math.round((H - titleH - divH) * 0.54)   // 상단 행
  const botH   = H - titleH - divH - topH                 // 하단 행

  // ── 치수 계산 ────────────────────────────────────────────
  const f1    = (v: number) => v.toFixed(1)

  // ══════════════════════════════════════════════════════════
  // 상단 행 레이아웃
  //   topY    = titleH
  //   왼쪽: Strain Diagram  (폭 = W*0.5 - 여백)
  //   오른쪽: 세로 단면     (폭 = W*0.5 - 여백)
  //   세로단면 높이 = topH (상단 패딩, 하단 b치수선 제외한 순 그리기 높이)
  // ══════════════════════════════════════════════════════════
  const topY = titleH

  // 상단 행: 좌우 분할 x
  const midX = Math.round(W / 2)

  // 세로 단면 (오른쪽 절반): 실제 b/h 비율 반영
  // padT2=여백, padB2=하단 b 치수선
  const padT2 = 30, padB2 = 22, padL2 = 40, padR2 = 60
  const vSecAreaW = W - midX - padL2 - padR2
  const vSecAreaH = topH - padT2 - padB2
  // 세로 단면 픽셀 크기 (b/h 비율)
  const vSecH = vSecAreaH
  const vSecW = Math.min(Math.round(vSecH * b / h), vSecAreaW)
  const vSecX = midX + padL2 + (vSecAreaW - vSecW) / 2
  const vSecY = topY + padT2

  // 세로 단면 스케일
  const vSY = vSecH / h
  const vCpx = c * vSY
  const vApx = a * vSY
  const vDpx = d * vSY
  const vCY  = vSecY + vCpx
  const vAY  = vSecY + vApx
  const vDY  = vSecY + vDpx
  const vCcY = vSecY + vApx / 2   // Cc 작용점

  // ── Strain Diagram 레이아웃 ───────────────────────────────
  // 왼쪽 절반. 변형률도는 "좌측 축(0선)=단면 우측, 오른쪽으로 변형률"
  // 즉 삼각형이 왼쪽으로 뻗음 (이미지와 동일)
  const padL1 = 60, padR1 = 30, padT1 = 28, padB1 = 18
  const strAreaW = midX - padL1 - padR1
  const strAreaH = topH - padT1 - padB1
  const strH = strAreaH   // 높이 = 단면 세로 픽셀
  const strSY = strH / h
  const strCpx = c * strSY
  const strDpx = d * strSY
  // 0-축 x (단면 오른쪽 경계 = strain diagram 오른쪽)
  const strX0 = midX - padR1   // 0-축 x
  const strY0 = topY + padT1   // 상단 y
  const strCY = strY0 + strCpx
  const strDY = strY0 + strDpx

  // εcu, εt → px 폭
  const eMax   = Math.max(0.003, Math.abs(Et)) * 1.15
  const eCuPx  = strAreaW * 0.003 / eMax
  const eTpx   = strAreaW * Math.abs(Et) / eMax

  // 삼각형 꼭짓점 (0축이 오른쪽, 변형률은 왼쪽으로)
  const compPts = `${strX0},${strY0} ${strX0 - eCuPx},${strY0} ${strX0},${strCY}`
  const tensPts = `${strX0},${strCY} ${strX0 - eTpx},${strDY} ${strX0},${strDY}`

  // ══════════════════════════════════════════════════════════
  // 하단 행 레이아웃: 가로 단면 (광폭보)
  //   가로 단면은 h/b 비율 (세로를 좁게)
  // ══════════════════════════════════════════════════════════
  const botY = topY + topH + divH
  const padLB = 52, padRB = 70, padTB = 18, padBB = 32
  const hSecAreaW = W - padLB - padRB
  const hSecAreaH = botH - padTB - padBB
  // 가로 단면 픽셀 (h/b 비율)
  const hSecW = hSecAreaW
  const hSecH = Math.min(Math.round(hSecW * h / b), hSecAreaH)
  const hSecX = padLB
  const hSecY = botY + padTB + (hSecAreaH - hSecH) / 2

  // 가로 단면 스케일 (y방향=h)
  const hSY2 = hSecH / h
  const hApx = a * hSY2   // 압축블록 깊이 (픽셀)
  const hDpx = d * hSY2   // 유효깊이 (픽셀)

  // 가로 단면에서 철근 배치 (8개, 하단 인장측)
  const hNBar = 8
  const hCoverPx = Math.max(hSecH * 0.09, 5)
  const hBarR = Math.max(hSecW * 0.008, 3.5)
  const hBarY = hSecY + hSecH - hCoverPx
  const hBarSpan = hSecW - hCoverPx * 2
  const hBarSpc = hBarSpan / (hNBar - 1)

  // 화살표 헬퍼
  const AH6 = 7, AW6 = 5

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
      style={{ display: 'block', background: '#ffffff' }}>
      <defs>
        {/* 콘크리트 해칭 */}
        <pattern id="sfd-conc" x="0" y="0" width="7" height="7"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#e8e8e8"/>
          <line x1="0" y1="0" x2="0" y2="7" stroke={GREY} strokeWidth="0.7"/>
        </pattern>
        {/* 압축블록 (녹색 해칭, 이미지와 동일) */}
        <pattern id="sfd-comp" x="0" y="0" width="6" height="6"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#c8ddc0"/>
          <line x1="0" y1="0" x2="0" y2="6" stroke="#7aaa6a" strokeWidth="0.8"/>
        </pattern>
        {/* 변형률 압축측 (사선 회색) */}
        <pattern id="sfd-strain-c" x="0" y="0" width="5" height="5"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#d8d8d8"/>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#aaaaaa" strokeWidth="0.6"/>
        </pattern>
      </defs>

      {/* ── 제목 영역 ── */}
      <text x={W / 2} y={16} textAnchor="middle"
        fontSize="14" fontFamily={serif} fontWeight="bold" fill={INK}>
        Bending Section Analysis of RC Beam
      </text>
      <text x={W / 2} y={32} textAnchor="middle"
        fontSize="11" fontFamily={serif} fill={INK2}>
        (Ultimate Limit State)
      </text>

      {/* ═══════════════════════════════════════════════════
          상단 좌: Strain Diagram
      ═══════════════════════════════════════════════════ */}
      <g>
        {/* 열 제목 */}
        <text x={(padL1 + strX0) / 2} y={topY + 16}
          textAnchor="middle" fontSize="12" fontFamily={serif} fontWeight="bold" fill={INK}
          style={{ textDecoration: 'underline' }}>
          Strain Diagram
        </text>

        {/* 0-축 (수직선) */}
        <line x1={strX0} y1={strY0} x2={strX0} y2={strY0 + strH}
          stroke={INK} strokeWidth="1.8"/>
        {/* 상단 수평선 */}
        <line x1={strX0 - eCuPx} y1={strY0} x2={strX0} y2={strY0}
          stroke={INK} strokeWidth="1.2"/>

        {/* 압축측 삼각형 */}
        <polygon points={compPts} fill="url(#sfd-strain-c)" stroke={INK} strokeWidth="1.0"/>
        {/* 인장측 삼각형 */}
        <polygon points={tensPts} fill="#f0f0f0" stroke={INK} strokeWidth="1.0"/>

        {/* 중립축 수평 점선 */}
        <line x1={strX0 - strAreaW * 0.7} y1={strCY} x2={strX0 + 15} y2={strCY}
          stroke={INK} strokeWidth="0.9" strokeDasharray="5 3"/>
        {/* d 위치 점선 */}
        <line x1={strX0 - strAreaW * 0.5} y1={strDY} x2={strX0 + 15} y2={strDY}
          stroke={INK} strokeWidth="0.7" strokeDasharray="3 2"/>

        {/* εcu = 0.003 (상단 좌측, 삼각형 바깥) */}
        <text x={strX0 - eCuPx - 4} y={strY0 - 4}
          textAnchor="end" fontSize="12" fontFamily={serif} fontStyle="italic" fill={INK}>
          ε<tspan fontSize="9" dy="2">cu</tspan>
          <tspan dy="-2" fontStyle="normal"> = 0.003</tspan>
        </text>

        {/* 중립축 c 레이블 */}
        <text x={strX0 - eCuPx * 0.3 - 2} y={strCY - 3}
          textAnchor="end" fontSize="11" fontFamily={serif} fontStyle="italic" fill={INK}>
          c
        </text>
        {/* → c 수평 화살표 (0축에서 오른쪽) */}
        <line x1={strX0 - eCuPx * 0.45} y1={strCY} x2={strX0 + 12} y2={strCY}
          stroke={INK} strokeWidth="1.0"/>
        <polygon points={`${strX0+15},${strCY} ${strX0+8},${strCY-3} ${strX0+8},${strCY+3}`} fill={INK}/>

        {/* εt (d 위치 좌측) */}
        <text x={strX0 - eTpx - 4} y={strDY + 5}
          textAnchor="end" fontSize="12" fontFamily={serif} fontStyle="italic" fill={INK}>
          ε<tspan fontSize="9" dy="2">t</tspan>
        </text>

        {/* c 치수선 (우측 0축 바깥) */}
        {(() => {
          const dx = strX0 + 22
          const AH = 5, AW = 3.5
          return (
            <g>
              <line x1={strX0} y1={strY0} x2={dx} y2={strY0} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={strX0} y1={strCY} x2={dx} y2={strCY} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={strY0 + AH} x2={dx} y2={strCY - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${strY0} ${dx-AW},${strY0+AH} ${dx+AW},${strY0+AH}`} fill={INK}/>
              <polygon points={`${dx},${strCY} ${dx-AW},${strCY-AH} ${dx+AW},${strCY-AH}`} fill={INK}/>
              <text x={dx + 4} y={(strY0 + strCY) / 2 + 4}
                fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>c</text>
            </g>
          )
        })()}

        {/* d 치수선 (우측, c 바깥) */}
        {(() => {
          const dx = strX0 + 40
          const AH = 5, AW = 3.5
          return (
            <g>
              <line x1={strX0 + 25} y1={strY0} x2={dx} y2={strY0} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={strX0 + 25} y1={strDY} x2={dx} y2={strDY} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={strY0 + AH} x2={dx} y2={strDY - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${strY0} ${dx-AW},${strY0+AH} ${dx+AW},${strY0+AH}`} fill={INK}/>
              <polygon points={`${dx},${strDY} ${dx-AW},${strDY-AH} ${dx+AW},${strDY-AH}`} fill={INK}/>
              <text x={dx + 4} y={(strY0 + strDY) / 2 + 4}
                fontSize="11" fontFamily={serif} fontStyle="italic" fill={INK}>
                d = {f1(d)} mm
              </text>
            </g>
          )
        })()}

        {/* c 수평 치수선 (하단, 삼각형 폭) */}
        {(() => {
          const dimY = strY0 + strH + 12
          const AH = 4, AW = 3
          return (
            <g>
              <line x1={strX0 - eCuPx} y1={strY0 + strH} x2={strX0 - eCuPx} y2={dimY + 3} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={strX0}          y1={strY0 + strH} x2={strX0}          y2={dimY + 3} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={strX0 - eCuPx + AH} y1={dimY} x2={strX0 - AH} y2={dimY} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${strX0 - eCuPx},${dimY} ${strX0-eCuPx+AH},${dimY-AW} ${strX0-eCuPx+AH},${dimY+AW}`} fill={INK}/>
              <polygon points={`${strX0},${dimY} ${strX0-AH},${dimY-AW} ${strX0-AH},${dimY+AW}`} fill={INK}/>
              <text x={strX0 - eCuPx / 2} y={dimY + 11}
                textAnchor="middle" fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>← c →</text>
            </g>
          )
        })()}
      </g>

      {/* ═══════════════════════════════════════════════════
          상단 우: 세로 단면 + Stress Block & Forces
      ═══════════════════════════════════════════════════ */}
      <g>
        {/* 열 제목 */}
        <text x={midX + (W - midX) / 2} y={topY + 16}
          textAnchor="middle" fontSize="12" fontFamily={serif} fontWeight="bold" fill={INK}
          style={{ textDecoration: 'underline' }}>
          Stress Block &amp; Forces
        </text>

        {/* Cc = 0.85fc·b·a 상단 레이블 */}
        <text x={vSecX + vSecW / 2} y={topY + 28}
          textAnchor="middle" fontSize="11" fontFamily={serif} fill={INK}>
          <tspan fontStyle="italic">C</tspan>
          <tspan fontSize="9" dy="2">c</tspan>
          <tspan dy="-2"> = 0.85</tspan>
          <tspan fontStyle="italic">f</tspan>
          <tspan fontSize="9" dy="2">c</tspan>
          <tspan dy="-2"> · </tspan>
          <tspan fontStyle="italic">b</tspan>
          <tspan> · </tspan>
          <tspan fontStyle="italic">a</tspan>
        </text>

        {/* 단면 외곽 */}
        <rect x={vSecX} y={vSecY} width={vSecW} height={vSecH}
          fill="url(#sfd-conc)" stroke={INK} strokeWidth="2"/>

        {/* 압축블록 (녹색) */}
        <rect x={vSecX} y={vSecY} width={vSecW} height={vApx}
          fill="url(#sfd-comp)" stroke="none"/>
        <line x1={vSecX} y1={vAY} x2={vSecX + vSecW} y2={vAY}
          stroke="#2a7a20" strokeWidth="1.5"/>
        <rect x={vSecX} y={vSecY} width={vSecW} height={vApx}
          fill="none" stroke="#2a7a20" strokeWidth="1.5"/>

        {/* 0.85fc·b·a 블록 내 레이블 */}
        {vApx > 18 && (
          <text x={vSecX + vSecW / 2} y={vSecY + vApx / 2 + 4}
            textAnchor="middle" fontSize="10" fontFamily={serif} fontStyle="italic" fill={INK}>
            0.85f<tspan fontSize="8" dy="2">c</tspan><tspan dy="-2">·b·a</tspan>
          </text>
        )}

        {/* 중립축 점선 */}
        <line x1={vSecX - 8} y1={vCY} x2={vSecX + vSecW + 8} y2={vCY}
          stroke={INK} strokeWidth="0.9" strokeDasharray="5 3"/>

        {/* 철근 중심 점선 */}
        <line x1={vSecX - 5} y1={vDY} x2={vSecX + vSecW + 5} y2={vDY}
          stroke={INK2} strokeWidth="0.7" strokeDasharray="3 2"/>

        {/* 철근 5개 (세로 단면) */}
        {Array.from({ length: 5 }, (_, i) => {
          const vCoverPx = Math.max(vSecW * 0.08, 5)
          const vBarR = Math.max(vSecW * 0.05, 4)
          const vBarSpan = vSecW - vCoverPx * 2
          const vBarSpc = vBarSpan / 4
          return (
            <circle key={i}
              cx={vSecX + vCoverPx + i * vBarSpc} cy={vDY} r={vBarR}
              fill={INK} stroke={INK} strokeWidth="0.5"/>
          )
        })}

        {/* ── Cc 위쪽 화살표 (↑, 단면 중앙) ── */}
        {(() => {
          const cx = vSecX + vSecW / 2
          const tipY = vSecY + vApx * 0.1
          const tailY = vCcY
          return (
            <g>
              <line x1={cx} y1={tailY} x2={cx} y2={tipY + AH6}
                stroke={INK} strokeWidth="2.2"/>
              <polygon points={`${cx},${tipY} ${cx-AW6},${tipY+AH6} ${cx+AW6},${tipY+AH6}`} fill={INK}/>
              <text x={cx + 6} y={(tipY + tailY) / 2 + 5}
                fontSize="14" fontFamily={serif} fontStyle="italic" fontWeight="bold" fill={INK}>
                C<tspan fontSize="10" dy="3">c</tspan>
              </text>
            </g>
          )
        })()}

        {/* a 치수선 (왼쪽) */}
        {(() => {
          const dx = vSecX - 16
          const AH = 4, AW = 3
          return (
            <g>
              <line x1={vSecX} y1={vSecY} x2={dx - 2} y2={vSecY} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={vSecX} y1={vAY}   x2={dx - 2} y2={vAY}   stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={vSecY + AH} x2={dx} y2={vAY - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${vSecY} ${dx-AW},${vSecY+AH} ${dx+AW},${vSecY+AH}`} fill={INK}/>
              <polygon points={`${dx},${vAY} ${dx-AW},${vAY-AH} ${dx+AW},${vAY-AH}`} fill={INK}/>
              <text x={dx - 4} y={(vSecY + vAY) / 2 + 4}
                textAnchor="end" fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>a</text>
            </g>
          )
        })()}

        {/* c 치수선 (왼쪽, a 바깥) */}
        {(() => {
          const dx = vSecX - 30
          const AH = 4, AW = 3
          return (
            <g>
              <line x1={vSecX - 14} y1={vSecY} x2={dx - 2} y2={vSecY} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={vSecX - 14} y1={vCY}   x2={dx - 2} y2={vCY}   stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={vSecY + AH} x2={dx} y2={vCY - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${vSecY} ${dx-AW},${vSecY+AH} ${dx+AW},${vSecY+AH}`} fill={INK}/>
              <polygon points={`${dx},${vCY} ${dx-AW},${vCY-AH} ${dx+AW},${vCY-AH}`} fill={INK}/>
              <text x={dx - 4} y={(vSecY + vCY) / 2 + 4}
                textAnchor="end" fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>c</text>
            </g>
          )
        })()}

        {/* d 치수선 (오른쪽) */}
        {(() => {
          const dx = vSecX + vSecW + 16
          const AH = 4, AW = 3
          return (
            <g>
              <line x1={vSecX + vSecW} y1={vSecY} x2={dx + 2} y2={vSecY} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={vSecX + vSecW} y1={vDY}   x2={dx + 2} y2={vDY}   stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={vSecY + AH} x2={dx} y2={vDY - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${vSecY} ${dx-AW},${vSecY+AH} ${dx+AW},${vSecY+AH}`} fill={INK}/>
              <polygon points={`${dx},${vDY} ${dx-AW},${vDY-AH} ${dx+AW},${vDY-AH}`} fill={INK}/>
              <text x={dx + 4} y={(vSecY + vDY) / 2 + 4}
                fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>d</text>
            </g>
          )
        })()}

        {/* z = jd 치수선 (오른쪽, d 바깥) */}
        {(() => {
          const dx = vSecX + vSecW + 34
          const AH = 4, AW = 3
          return (
            <g>
              <line x1={vSecX + vSecW + 18} y1={vCcY} x2={dx + 2} y2={vCcY} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={vSecX + vSecW + 18} y1={vDY}  x2={dx + 2} y2={vDY}  stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={vCcY + AH} x2={dx} y2={vDY - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${vCcY} ${dx-AW},${vCcY+AH} ${dx+AW},${vCcY+AH}`} fill={INK}/>
              <polygon points={`${dx},${vDY} ${dx-AW},${vDY-AH} ${dx+AW},${vDY-AH}`} fill={INK}/>
              <text x={dx + 4} y={(vCcY + vDY) / 2 + 4}
                fontSize="12" fontFamily={serif} fontStyle="italic" fill={INK}>
                z ≅ jd
              </text>
            </g>
          )
        })()}

        {/* b 치수선 (하단) */}
        {(() => {
          const dimY = vSecY + vSecH + 14
          const AH = 4, AW = 3
          return (
            <g>
              <line x1={vSecX}          y1={vSecY + vSecH} x2={vSecX}          y2={dimY + 3} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={vSecX + vSecW}  y1={vSecY + vSecH} x2={vSecX + vSecW}  y2={dimY + 3} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={vSecX + AH} y1={dimY} x2={vSecX + vSecW - AH} y2={dimY} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${vSecX},${dimY} ${vSecX+AH},${dimY-AW} ${vSecX+AH},${dimY+AW}`} fill={INK}/>
              <polygon points={`${vSecX+vSecW},${dimY} ${vSecX+vSecW-AH},${dimY-AW} ${vSecX+vSecW-AH},${dimY+AW}`} fill={INK}/>
              <text x={vSecX + vSecW / 2} y={dimY + 12}
                textAnchor="middle" fontSize="11" fontFamily={serif} fill={INK}>
                ← <tspan fontStyle="italic">b</tspan> = {b} mm →
              </text>
            </g>
          )
        })()}
      </g>

      {/* ═══════════════════════════════════════════════════
          하단: 광폭 가로 단면
      ═══════════════════════════════════════════════════ */}
      <g>
        {/* Cc 레이블 (하단 단면 좌상단) */}
        <text x={hSecX + hSecW * 0.18} y={botY + 13}
          textAnchor="middle" fontSize="11" fontFamily={serif} fill={INK}>
          <tspan fontStyle="italic">C</tspan>
          <tspan fontSize="9" dy="2">c</tspan>
          <tspan dy="-2"> = 0.85</tspan>
          <tspan fontStyle="italic">f</tspan>
          <tspan fontSize="9" dy="2">c</tspan>
          <tspan dy="-2"> · </tspan>
          <tspan fontStyle="italic">b · a</tspan>
        </text>

        {/* 단면 외곽 */}
        <rect x={hSecX} y={hSecY} width={hSecW} height={hSecH}
          fill="url(#sfd-conc)" stroke={INK} strokeWidth="2"/>

        {/* 압축블록 (녹색, 상단) */}
        <rect x={hSecX} y={hSecY} width={hSecW} height={hApx}
          fill="url(#sfd-comp)" stroke="none"/>
        <rect x={hSecX} y={hSecY} width={hSecW} height={hApx}
          fill="none" stroke="#2a7a20" strokeWidth="1.5"/>
        <line x1={hSecX} y1={hSecY + hApx} x2={hSecX + hSecW} y2={hSecY + hApx}
          stroke="#2a7a20" strokeWidth="1.5"/>

        {/* 유효깊이 점선 */}
        <line x1={hSecX - 5} y1={hSecY + hDpx} x2={hSecX + hSecW + 5} y2={hSecY + hDpx}
          stroke={INK2} strokeWidth="0.7" strokeDasharray="4 3"/>

        {/* 철근 (하단) */}
        {Array.from({ length: hNBar }, (_, i) => (
          <circle key={i}
            cx={hSecX + hCoverPx + i * hBarSpc} cy={hBarY} r={hBarR}
            fill={INK} stroke={INK} strokeWidth="0.5"/>
        ))}

        {/* h 치수선 (좌측) */}
        {(() => {
          const dx = hSecX - 16
          const AH = 5, AW = 3.5
          return (
            <g>
              <line x1={hSecX} y1={hSecY}          x2={dx - 2} y2={hSecY}          stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={hSecX} y1={hSecY + hSecH}  x2={dx - 2} y2={hSecY + hSecH}  stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={dx} y1={hSecY + AH} x2={dx} y2={hSecY + hSecH - AH} stroke={INK} strokeWidth="0.9"/>
              <polygon points={`${dx},${hSecY} ${dx-AW},${hSecY+AH} ${dx+AW},${hSecY+AH}`} fill={INK}/>
              <polygon points={`${dx},${hSecY+hSecH} ${dx-AW},${hSecY+hSecH-AH} ${dx+AW},${hSecY+hSecH-AH}`} fill={INK}/>
              <text x={dx - 4} y={hSecY + hSecH / 2 + 4}
                textAnchor="end" fontSize="11" fontFamily={serif} fontStyle="italic" fill={INK}>
                h = {h}
              </text>
            </g>
          )
        })()}

        {/* a 치수선 (내부 좌측, 세로) */}
        {(() => {
          const ax = hSecX + hSecW * 0.52
          const AH = 4, AW = 3
          return (
            <g>
              {/* 수직선 */}
              <line x1={ax} y1={hSecY + AH} x2={ax} y2={hSecY + hApx - AH} stroke={INK} strokeWidth="1.1"/>
              <polygon points={`${ax},${hSecY} ${ax-AW},${hSecY+AH} ${ax+AW},${hSecY+AH}`} fill={INK}/>
              <polygon points={`${ax},${hSecY+hApx} ${ax-AW},${hSecY+hApx-AH} ${ax+AW},${hSecY+hApx-AH}`} fill={INK}/>
              <text x={ax - 5} y={hSecY + hApx / 2 + 4}
                textAnchor="end" fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>a</text>
            </g>
          )
        })()}

        {/* z 화살표 (수평, a 오른쪽 끝에서 단면 오른쪽 끝으로) */}
        {(() => {
          const ay = hSecY + hApx / 2   // Cc 작용점 y (a/2)
          const Ty = hSecY + hDpx        // T 작용점 y (d)
          const zX1 = hSecX + hSecW * 0.56
          const zX2 = hSecX + hSecW - hCoverPx
          return (
            <g>
              {/* Cc 작용점 → T 작용점 z 세로 치수선 */}
              <line x1={zX1} y1={ay + 5} x2={zX1} y2={Ty - 5} stroke={INK} strokeWidth="1.2" strokeDasharray="4 2"/>
              <polygon points={`${zX1},${ay} ${zX1-3},${ay+6} ${zX1+3},${ay+6}`} fill={INK}/>
              <polygon points={`${zX1},${Ty} ${zX1-3},${Ty-6} ${zX1+3},${Ty-6}`} fill={INK}/>
              <text x={zX2 + 10} y={(ay + Ty) / 2 + 4}
                fontSize="13" fontFamily={serif} fontStyle="italic" fill={INK}>z</text>

              {/* z ← 수평 화살표 (왼쪽으로, Cc 방향 표시) */}
              <line x1={zX2} y1={ay} x2={hSecX + hSecW * 0.65} y2={ay}
                stroke={INK} strokeWidth="1.2"/>
              <polygon points={`${hSecX+hSecW*0.65-1},${ay} ${hSecX+hSecW*0.65+6},${ay-3.5} ${hSecX+hSecW*0.65+6},${ay+3.5}`} fill={INK}/>
            </g>
          )
        })()}

        {/* z ≅ jd 레이블 (우측) */}
        <text x={hSecX + hSecW + 8} y={hSecY + (hApx / 2 + hDpx) / 2 + 4}
          fontSize="12" fontFamily={serif} fontStyle="italic" fill={INK}>
          →z<tspan fontSize="10">≅</tspan>jd
        </text>

        {/* b 치수선 (하단) */}
        {(() => {
          const dimY = hSecY + hSecH + 14
          const AH = 5, AW = 3.5
          return (
            <g>
              <line x1={hSecX}          y1={hSecY + hSecH} x2={hSecX}          y2={dimY + 3} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={hSecX + hSecW}  y1={hSecY + hSecH} x2={hSecX + hSecW}  y2={dimY + 3} stroke={INK2} strokeWidth="0.5" strokeDasharray="2 1.5"/>
              <line x1={hSecX + AH} y1={dimY} x2={hSecX + hSecW - AH} y2={dimY} stroke={INK} strokeWidth="1.0"/>
              <polygon points={`${hSecX},${dimY} ${hSecX+AH},${dimY-AW} ${hSecX+AH},${dimY+AW}`} fill={INK}/>
              <polygon points={`${hSecX+hSecW},${dimY} ${hSecX+hSecW-AH},${dimY-AW} ${hSecX+hSecW-AH},${dimY+AW}`} fill={INK}/>
              <text x={hSecX + hSecW / 2} y={dimY + 14}
                textAnchor="middle" fontSize="12" fontFamily={serif} fill={INK}>
                ← <tspan fontStyle="italic">b</tspan> = {b} mm →
              </text>
            </g>
          )
        })()}

        {/* 철근 레이블 (하단) */}
        {(() => {
          // As 역산하여 철근 직경·개수 추정 (표시용)
          const rebarAreas: [number, number][] = [[10,71.3],[13,126.7],[16,198.6],[19,286.5],[22,387.1],[25,506.7],[29,642.4],[32,794.2],[35,956.6]]
          let bestLabel = `As = ${Math.round(As)} mm²`
          for (const [dia, area] of rebarAreas) {
            const n = Math.round(As / area)
            if (n >= 2 && n <= 20 && Math.abs(n * area - As) / As < 0.02) {
              bestLabel = `철근 ${n} = ${n}·H${dia}@${f1(b / n)} (100M)`
              break
            }
          }
          return (
            <text x={hSecX + hSecW / 2} y={hSecY + hSecH + 30}
              textAnchor="middle" fontSize="12" fontFamily={serif} fontWeight="bold" fill={INK}>
              철— {bestLabel}
            </text>
          )
        })()}
      </g>
    </svg>
  )
}
