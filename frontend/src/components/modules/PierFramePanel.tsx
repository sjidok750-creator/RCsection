import { useState, useMemo } from 'react'

// ════════════════════════════════════════════════════════════════
//  2D 교각 골조해석  —  Direct Stiffness Method
//  KDS 24 14 21 : 2021  도로교설계기준 (한계상태설계법)
// ════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────
//  타입
// ────────────────────────────────────────────────────────────────
interface FNode {
  id: number
  x: number   // m
  y: number   // m
  bc: [boolean, boolean, boolean]   // [Dx, Dy, Rz]
  isBearing?: boolean
  bearingIdx?: number
}

interface Member {
  id: number
  ni: number; nj: number
  E: number    // MPa
  A: number    // mm²
  I: number    // mm⁴
  type: 'coping' | 'column'
}

interface PointLoad { nodeId: number; Fx: number; Fy: number; Mz: number }

interface AnalysisResult {
  U: number[]
  reactions: { nodeId: number; Fx: number; Fy: number; Mz: number }[]
  memberForces: {
    memberId: number
    Ni: number; Vi: number; Mi: number
    Nj: number; Vj: number; Mj: number
  }[]
}

interface PierGeom {
  colCount: number
  colSpacing: number    // m
  colHeight: number     // m
  copingDepth: number   // m  코핑 중앙부 깊이
  copingDepthEnd: number // m  코핑 양단 깊이 (변단면)
  copingWidthB: number  // m  코핑 교축직각방향 폭 (단면 B)
  colWidth: number      // m
  colDepth: number      // m
  fck: number           // MPa
  bearingCount: number
}

interface BearingLoad { id: number; Fy: number; Fx: number; Mz: number }

// ────────────────────────────────────────────────────────────────
//  기본값
// ────────────────────────────────────────────────────────────────
const DEFAULT_GEOM: PierGeom = {
  colCount: 2, colSpacing: 6.0, colHeight: 8.0,
  copingDepth: 1.5, copingDepthEnd: 1.0, copingWidthB: 2.5,
  colWidth: 1.2, colDepth: 1.5,
  fck: 30, bearingCount: 2,
}
const DEFAULT_BEARING_LOADS: BearingLoad[] = [
  { id: 1, Fy: 2500, Fx: 80, Mz: 0 },
  { id: 2, Fy: 2500, Fx: 80, Mz: 0 },
]

function Ec(fck: number) { return 8500 * Math.pow(fck + 4, 1 / 3) }

// ────────────────────────────────────────────────────────────────
//  골조 모델 생성
//  코핑 중심선 = 기둥 상단 + copingDepth/2  에 모든 코핑 절점 배치
//  받침 절점도 코핑 중심선 y 에 놓고, 시각적으로만 코핑 상단에 표시
// ────────────────────────────────────────────────────────────────
function buildModel(geom: PierGeom, bearingLoads: BearingLoad[]) {
  const { colCount, colSpacing, colHeight, copingDepth, copingWidthB, colWidth, colDepth, fck } = geom
  const E = Ec(fck)

  const totalColSpan = colCount > 1 ? (colCount - 1) * colSpacing : 0
  const copingW      = totalColSpan + colWidth * 2   // 코핑 교축방향 전체 길이
  const copingCL     = colHeight + copingDepth / 2   // 코핑 중심선 y
  const copingTopY   = colHeight + copingDepth       // 코핑 상단 y (시각용)

  const Ac   = colWidth * colDepth * 1e6
  const Ic   = colWidth * Math.pow(colDepth, 3) / 12 * 1e12
  // 코핑 단면: B(교축직각방향 폭) × h(깊이)
  const Acop = copingWidthB * copingDepth      * 1e6
  const Icop = copingWidthB * Math.pow(copingDepth, 3) / 12 * 1e12

  // 기둥 x 좌표
  const colXs: number[] = []
  for (let i = 0; i < colCount; i++)
    colXs.push((i - (colCount - 1) / 2) * colSpacing)

  // 받침 x 좌표  →  기둥 스팬 범위 내 균등 배치
  const bc = geom.bearingCount
  const bearingSpan = totalColSpan > 0 ? totalColSpan : copingW * 0.5
  const bearingXs: number[] = bc === 1
    ? [0]
    : Array.from({ length: bc }, (_, i) => (i - (bc - 1) / 2) * (bearingSpan / (bc - 1 || 1)))

  // ── 절점 ──
  const nodes: FNode[] = []
  let nid = 1

  // 기초 (고정단)
  const baseIds: number[] = []
  for (const x of colXs) {
    nodes.push({ id: nid, x, y: 0, bc: [true, true, true] })
    baseIds.push(nid++)
  }

  // 기둥 상단 = 코핑 중심선 절점
  const topIds: number[] = []
  for (const x of colXs) {
    nodes.push({ id: nid, x, y: copingCL, bc: [false, false, false] })
    topIds.push(nid++)
  }

  // 코핑 양단 절점 (기둥 바깥 캔틸레버 단부)
  const copingEndIds: number[] = []
  const leftEnd = -copingW / 2
  const rightEnd = copingW / 2
  // 좌측 끝이 기둥 바깥인 경우에만 추가
  if (colXs.length > 0 && Math.abs(leftEnd - colXs[0]) > 0.01) {
    nodes.push({ id: nid, x: leftEnd, y: copingCL, bc: [false, false, false] })
    copingEndIds.push(nid++)
  }
  if (colXs.length > 0 && Math.abs(rightEnd - colXs[colXs.length - 1]) > 0.01) {
    nodes.push({ id: nid, x: rightEnd, y: copingCL, bc: [false, false, false] })
    copingEndIds.push(nid++)
  }

  // 받침 절점 (코핑 중심선 y, 시각적으로만 상단 표시)
  const bearingNodeIds: number[] = []
  for (let bi = 0; bi < bc; bi++) {
    // 기둥 위치와 겹치는지 확인
    const bx = bearingXs[bi]
    const colMatch = topIds.find(tid => {
      const tn = nodes.find(n => n.id === tid)
      return tn && Math.abs(tn.x - bx) < 0.01
    })
    if (colMatch) {
      // 기둥 상단 절점을 받침 절점으로 재사용
      const nd = nodes.find(n => n.id === colMatch)!
      nd.isBearing = true
      nd.bearingIdx = bi
      bearingNodeIds.push(colMatch)
    } else {
      nodes.push({
        id: nid, x: bx, y: copingCL,
        bc: [false, false, false],
        isBearing: true, bearingIdx: bi,
      })
      bearingNodeIds.push(nid++)
    }
  }

  // ── 부재 ──
  const members: Member[] = []
  let mid = 1

  // 기둥 (기초 → 코핑 중심선)
  for (let i = 0; i < colCount; i++)
    members.push({ id: mid++, ni: baseIds[i], nj: topIds[i], E, A: Ac, I: Ic, type: 'column' })

  // 코핑 절점 집합 = 기둥 상단 + 코핑 양단 + 받침(기둥과 안겹치는 것만), x 순서로 정렬
  const allCopingNodeIds = new Set([...topIds, ...copingEndIds, ...bearingNodeIds])
  const copingNodeSet = [...allCopingNodeIds]
    .map(id => ({ id, x: nodes.find(n => n.id === id)!.x }))
    .sort((a, b) => a.x - b.x)

  // 코핑 부재: 정렬된 절점 순서로 연결 (모두 같은 y)
  for (let i = 0; i < copingNodeSet.length - 1; i++)
    members.push({
      id: mid++,
      ni: copingNodeSet[i].id, nj: copingNodeSet[i + 1].id,
      E, A: Acop, I: Icop, type: 'coping',
    })

  // ── 하중 벡터 ──
  const pointLoads: PointLoad[] = bearingLoads
    .slice(0, bc)
    .map((bl, bi) => ({
      nodeId: bearingNodeIds[bi],
      Fx: bl.Fx, Fy: bl.Fy, Mz: bl.Mz,
    }))

  return { nodes, members, pointLoads, copingW, colXs, baseIds, topIds, bearingNodeIds, bearingXs, copingTopY }
}

// ────────────────────────────────────────────────────────────────
//  행렬 유틸
// ────────────────────────────────────────────────────────────────
function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map(r => r[j]))
}
function matMul(A: number[][], B: number[][]): number[][] {
  return A.map((ar, i) => B[0].map((_, j) => ar.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)))
}
function matVec(A: number[][], v: number[]): number[] {
  return A.map(r => r.reduce((s, a, j) => s + a * v[j], 0))
}
function gaussElim(Kin: number[][], Fin: number[]): number[] {
  const n = Fin.length
  const A = Kin.map((r, i) => [...r, Fin[i]])
  for (let c = 0; c < n; c++) {
    let mx = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[mx][c])) mx = r
    ;[A[c], A[mx]] = [A[mx], A[c]]
    if (Math.abs(A[c][c]) < 1e-14) continue
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      for (let cc = c; cc <= n; cc++) A[r][cc] -= f * A[c][cc]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = A[i][n]
    for (let j = i + 1; j < n; j++) x[i] -= A[i][j] * x[j]
    x[i] /= A[i][i] || 1
  }
  return x
}

// ────────────────────────────────────────────────────────────────
//  Direct Stiffness Method 해석
// ────────────────────────────────────────────────────────────────
function solveFrame(nodes: FNode[], members: Member[], pointLoads: PointLoad[]): AnalysisResult {
  const nDOF = nodes.length * 3
  const idx  = new Map(nodes.map((n, i) => [n.id, i]))
  const K    = Array.from({ length: nDOF }, () => new Array(nDOF).fill(0))
  const F    = new Array(nDOF).fill(0)

  for (const m of members) {
    const ni = idx.get(m.ni)!, nj = idx.get(m.nj)!
    const { x: xi, y: yi } = nodes[ni], { x: xj, y: yj } = nodes[nj]
    const L = Math.sqrt((xj - xi) ** 2 + (yj - yi) ** 2)
    if (L < 1e-12) continue

    const EA = (m.E / 1e3) * (m.A / 1e6)
    const EI = (m.E / 1e3) * (m.I / 1e12)

    const c = (xj - xi) / L, s = (yj - yi) / L
    const kL: number[][] = [
      [ EA/L,           0,          0,  -EA/L,           0,          0 ],
      [    0,  12*EI/L**3,  6*EI/L**2,      0, -12*EI/L**3,  6*EI/L**2 ],
      [    0,   6*EI/L**2,    4*EI/L,       0,  -6*EI/L**2,    2*EI/L  ],
      [-EA/L,           0,          0,   EA/L,           0,          0 ],
      [    0, -12*EI/L**3, -6*EI/L**2,     0,  12*EI/L**3, -6*EI/L**2 ],
      [    0,   6*EI/L**2,    2*EI/L,       0,  -6*EI/L**2,    4*EI/L  ],
    ]
    const T: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0))
    T[0][0]=c; T[0][1]=s; T[1][0]=-s; T[1][1]=c; T[2][2]=1
    T[3][3]=c; T[3][4]=s; T[4][3]=-s; T[4][4]=c; T[5][5]=1

    const kG = matMul(matMul(transpose(T), kL), T)
    const d  = [ni*3, ni*3+1, ni*3+2, nj*3, nj*3+1, nj*3+2]
    for (let r = 0; r < 6; r++)
      for (let cc = 0; cc < 6; cc++)
        K[d[r]][d[cc]] += kG[r][cc]
  }

  for (const pl of pointLoads) {
    const ni = idx.get(pl.nodeId)!
    F[ni*3] += pl.Fx; F[ni*3+1] += pl.Fy; F[ni*3+2] += pl.Mz
  }

  const PENALTY = 1e15
  for (const n of nodes) {
    const ni = idx.get(n.id)!
    if (n.bc[0]) K[ni*3  ][ni*3  ] += PENALTY
    if (n.bc[1]) K[ni*3+1][ni*3+1] += PENALTY
    if (n.bc[2]) K[ni*3+2][ni*3+2] += PENALTY
  }

  const U = gaussElim(K, F)

  const reactions = nodes
    .filter(n => n.bc.some(Boolean))
    .map(n => {
      const ni = idx.get(n.id)!
      return {
        nodeId: n.id,
        Fx: n.bc[0] ? PENALTY * U[ni*3  ] : 0,
        Fy: n.bc[1] ? PENALTY * U[ni*3+1] : 0,
        Mz: n.bc[2] ? PENALTY * U[ni*3+2] : 0,
      }
    })

  const memberForces = members.map(m => {
    const ni = idx.get(m.ni)!, nj = idx.get(m.nj)!
    const { x: xi, y: yi } = nodes[ni], { x: xj, y: yj } = nodes[nj]
    const L = Math.sqrt((xj-xi)**2 + (yj-yi)**2)
    if (L < 1e-12) return { memberId: m.id, Ni:0, Vi:0, Mi:0, Nj:0, Vj:0, Mj:0 }

    const EA = (m.E/1e3)*(m.A/1e6), EI = (m.E/1e3)*(m.I/1e12)
    const c = (xj-xi)/L, s = (yj-yi)/L
    const kL: number[][] = [
      [ EA/L,0,0,-EA/L,0,0],
      [0,12*EI/L**3,6*EI/L**2,0,-12*EI/L**3,6*EI/L**2],
      [0,6*EI/L**2,4*EI/L,0,-6*EI/L**2,2*EI/L],
      [-EA/L,0,0,EA/L,0,0],
      [0,-12*EI/L**3,-6*EI/L**2,0,12*EI/L**3,-6*EI/L**2],
      [0,6*EI/L**2,2*EI/L,0,-6*EI/L**2,4*EI/L],
    ]
    const T: number[][] = Array.from({length:6},()=>new Array(6).fill(0))
    T[0][0]=c;T[0][1]=s;T[1][0]=-s;T[1][1]=c;T[2][2]=1
    T[3][3]=c;T[3][4]=s;T[4][3]=-s;T[4][4]=c;T[5][5]=1

    const uG = [U[ni*3],U[ni*3+1],U[ni*3+2],U[nj*3],U[nj*3+1],U[nj*3+2]]
    const fL = matVec(kL, matVec(T, uG))
    return { memberId: m.id, Ni:fL[0], Vi:fL[1], Mi:fL[2], Nj:fL[3], Vj:fL[4], Mj:fL[5] }
  })

  return { U, reactions, memberForces }
}

// ────────────────────────────────────────────────────────────────
//  UI 헬퍼
// ────────────────────────────────────────────────────────────────
function GH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0.28rem 0.6rem',
      background:'#f0f2f5', borderBottom:'1px solid #d0d6e0', borderTop:'1px solid #d0d6e0',
      marginTop:'0.15rem',
    }}>
      <span style={{ fontSize:'0.7rem', fontWeight:700, color:'#2a3550', letterSpacing:'0.05em', fontFamily:'var(--font-mono)' }}>{title}</span>
      {sub && <span style={{ fontSize:'0.6rem', color:'#8899bb', fontFamily:'var(--font-mono)' }}>{sub}</span>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'8rem 1fr', alignItems:'center',
      borderBottom:'1px solid #e4e8f0', minHeight:'1.85rem' }}>
      <div style={{ fontSize:'0.7rem', fontWeight:600, color:'#3a4a6a', padding:'0.2rem 0.5rem',
        borderRight:'1px solid #e4e8f0', background:'#f5f7fa',
        height:'100%', display:'flex', alignItems:'center', whiteSpace:'nowrap', fontFamily:'var(--font-mono)' }}>
        {label}
      </div>
      <div style={{ padding:'0.15rem 0.3rem' }}>{children}</div>
    </div>
  )
}

function Num({ value, min, max, step=1, onChange }: {
  value:number; min?:number; max?:number; step?:number; onChange:(v:number)=>void
}) {
  return (
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width:'100%', fontSize:'0.78rem', fontFamily:'var(--font-mono)', padding:'0.1rem 0.25rem',
        border:'1px solid #c8d0e0', borderRadius:'2px', background:'#fff', color:'#1a2540' }}
    />
  )
}

// ────────────────────────────────────────────────────────────────
//  다이어그램 타입
// ────────────────────────────────────────────────────────────────
type DiagramType = 'none' | 'BMD' | 'SFD' | 'AFD'

const DIAGRAM_COLORS: Record<DiagramType, { stroke: string; fill: string; label: string }> = {
  none: { stroke: 'transparent', fill: 'transparent', label: '' },
  BMD:  { stroke: '#d04030', fill: 'rgba(210,60,40,0.10)', label: 'BMD (kN·m)' },
  SFD:  { stroke: '#2080c0', fill: 'rgba(30,120,190,0.10)', label: 'SFD (kN)' },
  AFD:  { stroke: '#209050', fill: 'rgba(30,140,70,0.10)',  label: 'AFD (kN)' },
}

// ────────────────────────────────────────────────────────────────
//  2D 모델링 SVG
// ────────────────────────────────────────────────────────────────
interface ModelSVGProps {
  nodes: FNode[]; members: Member[]; result: AnalysisResult | null
  geom: PierGeom; copingW: number
  bearingLoads: BearingLoad[]; bearingXs: number[]; bearingNodeIds: number[]
  copingTopY: number
  diagram: DiagramType; showDeformed: boolean
}

const C = {
  bg:       '#ffffff',
  bgPanel:  '#f8f9fc',
  grid:     '#e8ecf4',
  gridMaj:  '#cdd4e4',
  axis:     '#8899bb',
  gl:       '#7a9abf',
  column:   '#2d6fa8',
  colStroke:'#1a4e80',
  coping:   '#3a82c4',
  copStroke:'#1a5a9a',
  centerline:'#a0b8d8',
  deformed: '#f0a020',
  bearing:  '#cc2222',
  loadArr:  '#d45000',
  loadTxt:  '#b03000',
  rxnArr:   '#1a7a40',
  rxnTxt:   '#155a30',
  fixedFill:'#ccd8ee',
  fixedStr: '#7a9abf',
  nodeFree: '#2d6fa8',
  dimLine:  '#8899bb',
  label:    '#2a3a5a',
  labelSub: '#7a8aaa',
  title:    '#1a2a4a',
}

function ModelSVG({ nodes, members, result, geom, copingW,
  bearingLoads, bearingXs: _bearingXs, bearingNodeIds, copingTopY,
  diagram, showDeformed }: ModelSVGProps) {

  const VW = 720, VH = 520
  const PAD = { l:72, r:40, t:70, b:64 }
  const W = VW - PAD.l - PAD.r
  const H = VH - PAD.t - PAD.b

  const margin = Math.max(copingW * 0.3, 2.0)
  const xMin = -copingW / 2 - margin
  const xMax =  copingW / 2 + margin
  const yMin = -1.6
  const yMax = copingTopY + 2.4
  const xRange = xMax - xMin, yRange = yMax - yMin

  const sx = (x: number) => PAD.l + (x - xMin) / (xMax - xMin) * W
  const sy = (y: number) => PAD.t + H - (y - yMin) / (yMax - yMin) * H

  const pxPerM = W / (xMax - xMin)
  const colPxW = Math.max(geom.colWidth * pxPerM, 6)

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // ── 다이어그램 값 추출 ──
  const mfArr = result?.memberForces ?? []

  function getDiagValues(mf: typeof mfArr[0]): [number, number] {
    switch (diagram) {
      case 'BMD': return [mf.Mi, mf.Mj]
      case 'SFD': return [mf.Vi, mf.Vj]
      case 'AFD': return [mf.Ni, mf.Nj]
      default: return [0, 0]
    }
  }

  // 다이어그램 스케일 — 최대값을 부재 길이의 25%로 제한
  const allDiagVals = mfArr.flatMap(mf => {
    const [vi, vj] = getDiagValues(mf)
    return [Math.abs(vi), Math.abs(vj)]
  })
  const maxAbsDiag = Math.max(...allDiagVals, 1)
  // 최대 다이어그램 오프셋을 모델 높이의 8%로 제한
  const diagScale = (yRange * 0.08) / maxAbsDiag

  // 다이어그램 경로 (법선벡터 방향으로 오프셋)
  function diagPath(m: Member): string {
    const ni = nodeMap.get(m.ni)!, nj = nodeMap.get(m.nj)!
    const dx = nj.x - ni.x, dy = nj.y - ni.y
    const L  = Math.sqrt(dx*dx + dy*dy)
    if (L < 1e-12) return ''
    const nx = -dy / L, ny = dx / L

    const mf = mfArr.find(f => f.memberId === m.id)
    if (!mf) return ''
    const [valI, valJ] = getDiagValues(mf)

    const SEGS = 20
    const pts: string[] = []
    for (let k = 0; k <= SEGS; k++) {
      const t  = k / SEGS
      const V  = valI * (1 - t) + valJ * t
      const px = ni.x + t * dx + V * diagScale * nx
      const py = ni.y + t * dy + V * diagScale * ny
      pts.push(`${k === 0 ? 'M' : 'L'}${sx(px).toFixed(1)},${sy(py).toFixed(1)}`)
    }
    pts.push(`L${sx(nj.x).toFixed(1)},${sy(nj.y).toFixed(1)}`)
    pts.push(`L${sx(ni.x).toFixed(1)},${sy(ni.y).toFixed(1)}`)
    pts.push('Z')
    return pts.join(' ')
  }

  // 변형 배율
  const maxU = result ? Math.max(...result.U.filter(isFinite).map(Math.abs), 1e-12) : 1e-12
  const defScale = Math.min((H * 0.03) / maxU, 200)

  // 눈금
  const xStep = xRange > 14 ? 2 : xRange > 7 ? 1 : 0.5
  const yStep = yRange > 14 ? 2 : yRange > 7 ? 1 : 0.5
  const xTicks: number[] = [], yTicks: number[] = []
  for (let v = Math.ceil(xMin/xStep)*xStep; v <= xMax+0.01; v += xStep) xTicks.push(+v.toFixed(2))
  for (let v = Math.ceil(yMin/yStep)*yStep; v <= yMax+0.01; v += yStep) yTicks.push(+v.toFixed(2))

  // 코핑 변단면 폴리곤 좌표 계산
  // 코핑: 상단 평평, 하단이 변단면 (양단부가 얕아져서 하단이 올라감)
  const copLeft  = -copingW / 2
  const copRight =  copingW / 2
  const copTop   = copingTopY                        // 상단 y (평평)
  const copBotC  = geom.colHeight                    // 하단 중앙 y (가장 깊음)
  const dEnd     = geom.copingDepthEnd
  const copBotL  = copTop - dEnd                     // 좌단 하단 y (얕음)
  const copBotR  = copTop - dEnd                     // 우단 하단 y (얕음)
  // 외측 기둥 x 좌표
  const colXs = Array.from({ length: geom.colCount }, (_, i) =>
    (i - (geom.colCount - 1) / 2) * geom.colSpacing)
  const outerL = colXs.length > 0 ? colXs[0] - geom.colWidth / 2 : copLeft
  const outerR = colXs.length > 0 ? colXs[colXs.length - 1] + geom.colWidth / 2 : copRight

  // 변단면 여부
  const isTapered = Math.abs(geom.copingDepth - dEnd) > 0.01

  // 코핑 폴리곤: 상단 평평 + 하단 변단면
  const copPoints: string = isTapered
    ? [
        // 상단 (좌→우, 평평)
        `${sx(copLeft).toFixed(1)},${sy(copTop).toFixed(1)}`,
        `${sx(copRight).toFixed(1)},${sy(copTop).toFixed(1)}`,
        // 하단 (우→좌, 변단면: 양단 얕고 기둥구간 깊음)
        `${sx(copRight).toFixed(1)},${sy(copBotR).toFixed(1)}`,   // 우단 하단 (얕음)
        `${sx(outerR).toFixed(1)},${sy(copBotC).toFixed(1)}`,     // 우측 기둥 외측 (깊음)
        `${sx(outerL).toFixed(1)},${sy(copBotC).toFixed(1)}`,     // 좌측 기둥 외측 (깊음)
        `${sx(copLeft).toFixed(1)},${sy(copBotL).toFixed(1)}`,    // 좌단 하단 (얕음)
      ].join(' ')
    : [
        // 등단면: 직사각형
        `${sx(copLeft).toFixed(1)},${sy(copTop).toFixed(1)}`,
        `${sx(copRight).toFixed(1)},${sy(copTop).toFixed(1)}`,
        `${sx(copRight).toFixed(1)},${sy(copBotC).toFixed(1)}`,
        `${sx(copLeft).toFixed(1)},${sy(copBotC).toFixed(1)}`,
      ].join(' ')

  const diagCol = DIAGRAM_COLORS[diagram]

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%"
      style={{ display:'block', background: C.bg, borderRadius:'6px',
        border:'1px solid #ccd4e4', userSelect:'none',
        boxShadow:'0 2px 12px rgba(40,60,100,0.10)' }}>
      <defs>
        <pattern id="pg-sm" patternUnits="userSpaceOnUse" width={xStep*pxPerM} height={yStep*(H/(yMax-yMin))}>
          <path d={`M ${xStep*pxPerM} 0 L 0 0 0 ${yStep*(H/(yMax-yMin))}`}
            fill="none" stroke={C.grid} strokeWidth="0.7"/>
        </pattern>
        <marker id="arr-load" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <polygon points="0,0 8,4 0,8" fill={C.loadArr}/>
        </marker>
        <marker id="arr-rxn" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto">
          <polygon points="8,0 0,4 8,8" fill={C.rxnArr}/>
        </marker>
        <marker id="arr-dim-e" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <line x1="0" y1="6" x2="6" y2="0" stroke={C.dimLine} strokeWidth="1.2"/>
        </marker>
        <marker id="arr-dim-s" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto-start-reverse">
          <line x1="0" y1="6" x2="6" y2="0" stroke={C.dimLine} strokeWidth="1.2"/>
        </marker>
        {/* 클리핑 — 다이어그램이 모델 바깥으로 넘치지 않도록 */}
        <clipPath id="plot-clip">
          <rect x={PAD.l} y={PAD.t} width={W} height={H}/>
        </clipPath>
      </defs>

      {/* 배경 */}
      <rect width={VW} height={VH} fill={C.bg}/>
      <rect x={PAD.l} y={PAD.t} width={W} height={H} fill={C.bgPanel}/>
      <rect x={PAD.l} y={PAD.t} width={W} height={H} fill="url(#pg-sm)" opacity="0.9"/>
      <rect x={PAD.l} y={PAD.t} width={W} height={H}
        fill="none" stroke={C.gridMaj} strokeWidth="1"/>

      {/* 축 눈금 + 격자선 */}
      {xTicks.map(v => (
        <g key={`xt-${v}`}>
          <line x1={sx(v)} y1={PAD.t+H} x2={sx(v)} y2={PAD.t+H+4} stroke={C.axis} strokeWidth="1"/>
          <line x1={sx(v)} y1={PAD.t} x2={sx(v)} y2={PAD.t+H} stroke={C.gridMaj} strokeWidth="0.6"/>
          <text x={sx(v)} y={PAD.t+H+14} textAnchor="middle"
            fill={C.axis} fontSize="9" fontFamily="JetBrains Mono,monospace">{v}</text>
        </g>
      ))}
      {yTicks.map(v => (
        <g key={`yt-${v}`}>
          <line x1={PAD.l-4} y1={sy(v)} x2={PAD.l} y2={sy(v)} stroke={C.axis} strokeWidth="1"/>
          <line x1={PAD.l} y1={sy(v)} x2={PAD.l+W} y2={sy(v)} stroke={C.gridMaj} strokeWidth="0.6"/>
          <text x={PAD.l-7} y={sy(v)+4} textAnchor="end"
            fill={C.axis} fontSize="9" fontFamily="JetBrains Mono,monospace">{v}</text>
        </g>
      ))}
      <text x={PAD.l+W/2} y={VH-6} textAnchor="middle"
        fill={C.axis} fontSize="9" fontFamily="JetBrains Mono,monospace">x (m)</text>
      <text x={10} y={PAD.t+H/2} textAnchor="middle" fill={C.axis} fontSize="9"
        fontFamily="JetBrains Mono,monospace"
        transform={`rotate(-90,10,${PAD.t+H/2})`}>y (m)</text>

      {/* 지반선 */}
      <line x1={PAD.l} y1={sy(0)} x2={PAD.l+W} y2={sy(0)}
        stroke={C.gl} strokeWidth="1.5" strokeDasharray="10,5"/>
      {Array.from({ length: Math.floor(W/18)+1 }, (_, i) => (
        <line key={i} x1={PAD.l+i*18} y1={sy(0)}
          x2={PAD.l+i*18-7} y2={sy(0)+10}
          stroke={C.gl} strokeWidth="1" opacity="0.6"/>
      ))}
      <text x={PAD.l+6} y={sy(0)-5}
        fill={C.gl} fontSize="8" fontFamily="JetBrains Mono,monospace">G.L ±0.000</text>

      {/* 다이어그램 (BMD/SFD/AFD) — 클리핑 적용 */}
      {diagram !== 'none' && result && (
        <g clipPath="url(#plot-clip)">
          {members.map(m => {
            const path = diagPath(m)
            if (!path) return null
            const mf = mfArr.find(f => f.memberId === m.id)!
            const ni = nodeMap.get(m.ni)!, nj = nodeMap.get(m.nj)!
            const dx = nj.x-ni.x, dy = nj.y-ni.y
            const L  = Math.sqrt(dx*dx+dy*dy)
            if (L < 1e-12) return null
            const nx = -dy/L, ny = dx/L
            const [valI, valJ] = getDiagValues(mf)
            return (
              <g key={`diag-${m.id}`}>
                <path d={path} fill={diagCol.fill} stroke={diagCol.stroke} strokeWidth="1.3"/>
                {/* i단 값 */}
                {Math.abs(valI) > 1 && (() => {
                  const px = ni.x + valI * diagScale * nx
                  const py = ni.y + valI * diagScale * ny
                  return <text x={sx(px)+(m.type==='column'?5:-5)} y={sy(py)+(m.type==='coping'?-5:0)}
                    textAnchor={m.type==='column'?'start':'end'}
                    fill={diagCol.stroke} fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700">
                    {Math.abs(valI).toFixed(0)}
                  </text>
                })()}
                {/* j단 값 */}
                {Math.abs(valJ) > 1 && (() => {
                  const px = nj.x + valJ * diagScale * nx
                  const py = nj.y + valJ * diagScale * ny
                  return <text x={sx(px)+(m.type==='column'?5:-5)} y={sy(py)+(m.type==='coping'?-5:4)}
                    textAnchor={m.type==='column'?'start':'end'}
                    fill={diagCol.stroke} fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700">
                    {Math.abs(valJ).toFixed(0)}
                  </text>
                })()}
              </g>
            )
          })}
        </g>
      )}

      {/* 변형 형상 */}
      {showDeformed && result && members.map(m => {
        const ni_i = nodes.findIndex(n => n.id === m.ni)
        const nj_i = nodes.findIndex(n => n.id === m.nj)
        const ni   = nodeMap.get(m.ni)!, nj = nodeMap.get(m.nj)!
        const dxi  = result.U[ni_i*3]*defScale,  dyi = result.U[ni_i*3+1]*defScale
        const dxj  = result.U[nj_i*3]*defScale,  dyj = result.U[nj_i*3+1]*defScale
        return (
          <line key={`def-${m.id}`}
            x1={sx(ni.x+dxi)} y1={sy(ni.y+dyi)}
            x2={sx(nj.x+dxj)} y2={sy(nj.y+dyj)}
            stroke={C.deformed} strokeWidth="1.8" strokeDasharray="5,3" opacity="0.85"/>
        )
      })}

      {/* 기둥 단면 — 좌표 기반 실제 폭/높이 */}
      {members.filter(m => m.type === 'column').map(m => {
        const ni = nodeMap.get(m.ni)!, nj = nodeMap.get(m.nj)!
        return (
          <rect key={`col-${m.id}`}
            x={sx(nj.x) - colPxW/2} y={sy(nj.y)}
            width={colPxW} height={sy(ni.y) - sy(nj.y)}
            fill={C.column} stroke={C.colStroke} strokeWidth="1.2" rx="1" opacity="0.82"/>
        )
      })}

      {/* 코핑 단면 — 변단면 대응 폴리곤 */}
      <polygon points={copPoints}
        fill={C.coping} stroke={C.copStroke} strokeWidth="1.2" opacity="0.82"/>

      {/* 부재 중심선 */}
      {members.map(m => {
        const ni = nodeMap.get(m.ni)!, nj = nodeMap.get(m.nj)!
        return (
          <line key={`cl-${m.id}`}
            x1={sx(ni.x)} y1={sy(ni.y)} x2={sx(nj.x)} y2={sy(nj.y)}
            stroke={C.centerline} strokeWidth="0.8" strokeDasharray="3,4" opacity="0.7"/>
        )
      })}

      {/* 하중 화살표 (코핑 상단 위치에서 표시) */}
      {bearingLoads.slice(0, geom.bearingCount).map((bl, bi) => {
        const bnid = bearingNodeIds[bi]
        const bn   = nodeMap.get(bnid)
        if (!bn) return null
        const bx = sx(bn.x), by = sy(copingTopY)
        const maxFy  = Math.max(...bearingLoads.map(b => b.Fy), 1)
        const arrLen = 30 + Math.abs(bl.Fy) / maxFy * 40
        const hLen   = Math.min(Math.abs(bl.Fx) / 200 * 28 + 10, 45)
        return (
          <g key={`load-${bi}`}>
            <line x1={bx} y1={by - arrLen} x2={bx} y2={by - 6}
              stroke={C.loadArr} strokeWidth="2" markerEnd="url(#arr-load)"/>
            <text x={bx + 5} y={by - arrLen/2 + 3}
              fill={C.loadTxt} fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">
              {bl.Fy}
            </text>
            <text x={bx + 5} y={by - arrLen/2 + 13}
              fill={C.loadTxt} fontSize="8" fontFamily="JetBrains Mono,monospace" opacity="0.7">
              kN
            </text>
            {Math.abs(bl.Fx) > 0.1 && (
              <>
                <line
                  x1={bl.Fx > 0 ? bx - hLen : bx + hLen} y1={by - 18}
                  x2={bx} y2={by - 18}
                  stroke={C.loadArr} strokeWidth="1.6" markerEnd="url(#arr-load)"/>
                <text
                  x={bl.Fx > 0 ? bx - hLen - 3 : bx + hLen + 3}
                  y={by - 22}
                  textAnchor={bl.Fx > 0 ? 'end' : 'start'}
                  fill={C.loadTxt} fontSize="8" fontFamily="JetBrains Mono,monospace">
                  {bl.Fx}kN
                </text>
              </>
            )}
          </g>
        )
      })}

      {/* 절점 */}
      {nodes.map(n => {
        const isFixed   = n.bc.some(Boolean)
        const isBearing = n.isBearing ?? false
        const px = sx(n.x), py = sy(n.y)

        if (isFixed) {
          return (
            <g key={`nd-${n.id}`}>
              <rect x={px-13} y={py} width="26" height="10"
                fill={C.fixedFill} stroke={C.fixedStr} strokeWidth="1.2" rx="1"/>
              {Array.from({length:6},(_,i) => (
                <line key={i}
                  x1={px-12+i*5} y1={py+10}
                  x2={px-15+i*5} y2={py+18}
                  stroke={C.fixedStr} strokeWidth="1.1"/>
              ))}
              <text x={px+16} y={py-4}
                fill={C.labelSub} fontSize="8" fontFamily="JetBrains Mono,monospace">N{n.id}</text>
            </g>
          )
        }

        if (isBearing) {
          // 받침 절점은 시각적으로 코핑 상단에 표시
          const byVis = sy(copingTopY)
          return (
            <g key={`nd-${n.id}`}>
              <circle cx={px} cy={byVis} r="7"
                fill="#fff" stroke={C.bearing} strokeWidth="2"/>
              <circle cx={px} cy={byVis} r="3.5"
                fill={C.bearing}/>
              <text x={px} y={byVis-12} textAnchor="middle"
                fill={C.bearing} fontSize="8" fontFamily="JetBrains Mono,monospace" fontWeight="700">
                BRG{(n.bearingIdx ?? 0)+1}
              </text>
            </g>
          )
        }

        return (
          <g key={`nd-${n.id}`}>
            <circle cx={px} cy={py} r="5"
              fill="#fff" stroke={C.nodeFree} strokeWidth="2"/>
            <text x={px+8} y={py-5}
              fill={C.labelSub} fontSize="8" fontFamily="JetBrains Mono,monospace">N{n.id}</text>
          </g>
        )
      })}

      {/* 반력 화살표 */}
      {result && result.reactions.map(r => {
        const n  = nodeMap.get(r.nodeId)!
        const px = sx(n.x), py = sy(n.y)
        const sc = 0.014
        const ryL = Math.min(Math.abs(r.Fy)*sc, 48)+10
        const rxL = Math.min(Math.abs(r.Fx)*sc, 32)+6
        return (
          <g key={`rxn-${r.nodeId}`}>
            {Math.abs(r.Fy) > 5 && (
              <>
                <line x1={px} y1={py+20} x2={px} y2={py+20+ryL}
                  stroke={C.rxnArr} strokeWidth="1.8" markerEnd="url(#arr-rxn)"/>
                <text x={px+5} y={py+20+ryL/2+4}
                  fill={C.rxnTxt} fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700">
                  {r.Fy.toFixed(0)}
                </text>
              </>
            )}
            {Math.abs(r.Fx) > 5 && (
              <line
                x1={px+(r.Fx>0?rxL:-rxL)} y1={py+14}
                x2={px} y2={py+14}
                stroke={C.rxnArr} strokeWidth="1.5" markerEnd="url(#arr-rxn)"/>
            )}
          </g>
        )
      })}

      {/* 치수선 — 기둥 높이 + 코핑 깊이 */}
      {(() => {
        const lx = PAD.l + 16
        return (
          <g>
            <line x1={lx} y1={sy(0)} x2={lx} y2={sy(geom.colHeight)}
              stroke={C.dimLine} strokeWidth="1"
              markerStart="url(#arr-dim-s)" markerEnd="url(#arr-dim-e)"/>
            <text x={lx-8} y={(sy(0)+sy(geom.colHeight))/2+4}
              textAnchor="middle" fill={C.dimLine} fontSize="9"
              fontFamily="JetBrains Mono,monospace"
              transform={`rotate(-90,${lx-8},${(sy(0)+sy(geom.colHeight))/2})`}>
              H={geom.colHeight}m
            </text>
            <line x1={lx} y1={sy(geom.colHeight)} x2={lx} y2={sy(copingTopY)}
              stroke={C.dimLine} strokeWidth="0.8"
              markerStart="url(#arr-dim-s)" markerEnd="url(#arr-dim-e)"/>
          </g>
        )
      })()}

      {/* 코핑 폭 치수선 */}
      {(() => {
        const dy = sy(copingTopY) - 15
        return (
          <g>
            <line x1={sx(copLeft)} y1={dy} x2={sx(copRight)} y2={dy}
              stroke={C.dimLine} strokeWidth="0.8"
              markerStart="url(#arr-dim-s)" markerEnd="url(#arr-dim-e)"/>
            <text x={(sx(copLeft)+sx(copRight))/2} y={dy-3}
              textAnchor="middle" fill={C.dimLine} fontSize="8"
              fontFamily="JetBrains Mono,monospace">
              L={copingW.toFixed(2)}m
            </text>
          </g>
        )
      })()}

      {/* 부재 라벨 */}
      {members.map((m, idx) => {
        const ni = nodeMap.get(m.ni)!, nj = nodeMap.get(m.nj)!
        const mx = (ni.x+nj.x)/2, my = (ni.y+nj.y)/2
        const isCop = m.type === 'coping'
        return (
          <text key={`ml-${m.id}`}
            x={sx(mx)+(isCop?0:colPxW/2+5)} y={sy(my)+(isCop?-8:0)}
            fill={C.label} fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700" opacity="0.75"
            textAnchor={isCop ? 'middle' : 'start'}>
            {isCop ? `COP-${idx}` : `COL-${idx+1}`}
          </text>
        )
      })}

      {/* 타이틀 */}
      <text x={PAD.l} y={PAD.t-22}
        fill={C.title} fontSize="12" fontFamily="JetBrains Mono,monospace" fontWeight="700"
        letterSpacing="0.06em">
        2D PIER FRAME  ·  DSM
      </text>
      <text x={PAD.l} y={PAD.t-8}
        fill={C.labelSub} fontSize="9" fontFamily="JetBrains Mono,monospace">
        {nodes.length} nodes  ·  {members.length} members  ·  {nodes.length*3} DOF  ·  KDS 24 14 21
      </text>

      {/* 범례 — 우상단 */}
      {diagram !== 'none' && (
        <g transform={`translate(${PAD.l+W-120},${PAD.t+8})`}>
          <rect x="0" y="0" width="116" height="18" fill="rgba(255,255,255,0.9)" rx="2"
            stroke={C.gridMaj} strokeWidth="0.8"/>
          <rect x="6" y="5" width="16" height="8" fill={diagCol.fill} stroke={diagCol.stroke} strokeWidth="0.8"/>
          <text x="26" y="13" fill={diagCol.stroke} fontSize="9" fontFamily="JetBrains Mono,monospace">
            {diagCol.label}
          </text>
        </g>
      )}
      {showDeformed && (
        <g transform={`translate(${PAD.l+W-120},${PAD.t+(diagram!=='none'?30:8)})`}>
          <rect x="0" y="0" width="116" height="18" fill="rgba(255,255,255,0.9)" rx="2"
            stroke={C.gridMaj} strokeWidth="0.8"/>
          <line x1="6" y1="9" x2="22" y2="9" stroke={C.deformed} strokeWidth="1.8" strokeDasharray="4,2"/>
          <text x="26" y="13" fill={C.deformed} fontSize="9" fontFamily="JetBrains Mono,monospace">DEFORMED</text>
        </g>
      )}
    </svg>
  )
}

// ────────────────────────────────────────────────────────────────
//  결과 테이블
// ────────────────────────────────────────────────────────────────
function ResultSection({ result, members }: { result: AnalysisResult; members: Member[] }) {
  const [tab, setTab] = useState<'member'|'reaction'>('member')
  const tb = (a: boolean): React.CSSProperties => ({
    border:'none', padding:'0.22rem 0.75rem',
    fontSize:'0.65rem', fontWeight:700, fontFamily:'var(--font-mono)', cursor:'pointer',
    background: a ? '#1a4e80' : '#e8eef6', color: a ? '#fff' : '#3a5a8a',
    borderRadius:'2px 2px 0 0',
  })
  const th: React.CSSProperties = {
    padding:'0.25rem 0.45rem', borderBottom:'2px solid #b0c0da',
    color:'#2a3a5a', fontWeight:700, background:'#edf1f8', fontFamily:'var(--font-mono)',
    fontSize:'0.67rem', whiteSpace:'nowrap',
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ display:'flex', gap:'2px', padding:'0.3rem 0.4rem 0',
        background:'#f0f4fa', borderBottom:'1px solid #c8d4e8' }}>
        <button style={tb(tab==='member')} onClick={()=>setTab('member')}>부재력</button>
        <button style={tb(tab==='reaction')} onClick={()=>setTab('reaction')}>반력</button>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'0.4rem', background:'#fff' }}>
        {tab === 'member' && (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.68rem', fontFamily:'var(--font-mono)' }}>
            <thead>
              <tr>
                {['부재','유형','Ni(kN)','Vi(kN)','Mi(kN·m)','Nj(kN)','Vj(kN)','Mj(kN·m)'].map((h,hi) => (
                  <th key={h} style={{ ...th, textAlign: hi<2?'left':'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.memberForces.map((mf, i) => {
                const mem = members.find(m => m.id === mf.memberId)
                const isCop = mem?.type === 'coping'
                const maxM  = Math.max(Math.abs(mf.Mi), Math.abs(mf.Mj))
                return (
                  <tr key={mf.memberId} style={{ background: i%2===0?'#fff':'#f5f7fc' }}>
                    <td style={{ padding:'0.22rem 0.45rem', fontWeight:700, color:'#2a3a5a' }}>
                      {isCop ? `COP-${i}` : `COL-${i+1}`}
                    </td>
                    <td style={{ padding:'0.22rem 0.45rem' }}>
                      <span style={{ fontSize:'0.6rem', padding:'0.05rem 0.35rem', borderRadius:'2px',
                        fontWeight:700, background: isCop?'#deeaf8':'#e8f0f8',
                        color: isCop?'#1a5a90':'#3a6a9a' }}>
                        {isCop ? 'COPING' : 'COLUMN'}
                      </span>
                    </td>
                    {[mf.Ni,mf.Vi,mf.Mi,mf.Nj,mf.Vj,mf.Mj].map((v, vi) => (
                      <td key={vi} style={{ padding:'0.22rem 0.45rem', textAlign:'right',
                        fontWeight: vi===2||vi===5 ? 700 : 400,
                        color: vi===2||vi===5
                          ? maxM>3000?'#c01010':maxM>1500?'#c07010':'#1a7a30'
                          : '#2a3a5a' }}>
                        {isFinite(v) ? v.toFixed(1) : '\u2014'}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {tab === 'reaction' && (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.68rem', fontFamily:'var(--font-mono)' }}>
            <thead>
              <tr>
                {['절점','Rx(kN)','Ry(kN)','Rm(kN·m)'].map((h,hi) => (
                  <th key={h} style={{ ...th, textAlign: hi===0?'left':'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.reactions.map((r, i) => (
                <tr key={r.nodeId} style={{ background: i%2===0?'#fff':'#f5f7fc' }}>
                  <td style={{ padding:'0.22rem 0.5rem', fontWeight:700, color:'#2a3a5a' }}>N{r.nodeId}</td>
                  <td style={{ padding:'0.22rem 0.5rem', textAlign:'right',
                    color: Math.abs(r.Fx)>5?'#c07010':'#8899bb' }}>{r.Fx.toFixed(1)}</td>
                  <td style={{ padding:'0.22rem 0.5rem', textAlign:'right', color:'#2a3a5a', fontWeight:600 }}>{r.Fy.toFixed(1)}</td>
                  <td style={{ padding:'0.22rem 0.5rem', textAlign:'right',
                    color: Math.abs(r.Mz)>5?'#1a5a90':'#8899bb' }}>{r.Mz.toFixed(1)}</td>
                </tr>
              ))}
              <tr style={{ background:'#edf1f8', borderTop:'2px solid #b0c0da' }}>
                <td style={{ padding:'0.22rem 0.5rem', fontWeight:700, color:'#1a2a4a' }}>{'\u03A3'}</td>
                <td style={{ padding:'0.22rem 0.5rem', textAlign:'right', fontWeight:700, color:'#1a2a4a' }}>
                  {result.reactions.reduce((s,r)=>s+r.Fx,0).toFixed(1)}
                </td>
                <td style={{ padding:'0.22rem 0.5rem', textAlign:'right', fontWeight:700, color:'#1a2a4a' }}>
                  {result.reactions.reduce((s,r)=>s+r.Fy,0).toFixed(1)}
                </td>
                <td style={{ padding:'0.22rem 0.5rem', textAlign:'right', fontWeight:700, color:'#1a2a4a' }}>
                  {result.reactions.reduce((s,r)=>s+r.Mz,0).toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
//  메인 패널
// ────────────────────────────────────────────────────────────────
export default function PierFramePanel() {
  const [geom, setGeom]               = useState<PierGeom>(DEFAULT_GEOM)
  const [bearingLoads, setBearingLoads] = useState<BearingLoad[]>(DEFAULT_BEARING_LOADS)
  const [diagram, setDiagram]         = useState<DiagramType>('BMD')
  const [showDeformed, setShowDeformed] = useState(false)
  const [activeView, setActiveView]   = useState<'model'|'result'>('model')

  const updG = (patch: Partial<PierGeom>) => setGeom(g => ({ ...g, ...patch }))

  const setColCount = (n: number) => {
    const newBc = n + 1
    setBearingLoads(prev => {
      const arr = [...prev]
      while (arr.length < newBc) arr.push({ id: arr.length+1, Fy:2000, Fx:60, Mz:0 })
      return arr.slice(0, newBc)
    })
    updG({ colCount: n, bearingCount: newBc })
  }

  const syncBearings = (count: number) => {
    setBearingLoads(prev => {
      const arr = [...prev]
      while (arr.length < count) arr.push({ id: arr.length+1, Fy:2000, Fx:60, Mz:0 })
      return arr.slice(0, count)
    })
    updG({ bearingCount: count })
  }

  const { nodes, members, pointLoads, copingW, bearingXs, bearingNodeIds, copingTopY } =
    useMemo(() => buildModel(geom, bearingLoads), [geom, bearingLoads])

  const result = useMemo(
    () => solveFrame(nodes, members, pointLoads),
    [nodes, members, pointLoads]
  )

  const bvLight = (a: boolean): React.CSSProperties => ({
    flex:1, border:'1px solid #c0cce0', padding:'0.16rem 0', cursor:'pointer',
    fontSize:'0.72rem', fontWeight:700, fontFamily:'var(--font-mono)', borderRadius:'2px',
    background: a ? '#1a4e80' : '#f0f4fa',
    color:      a ? '#fff'    : '#3a5a8a',
  })
  const bvTool = (a: boolean): React.CSSProperties => ({
    border:'1px solid #c0cce0', padding:'0.18rem 0.55rem', cursor:'pointer',
    fontSize:'0.65rem', fontWeight:700, fontFamily:'var(--font-mono)', borderRadius:'3px',
    background: a ? '#1a4e80' : '#eef2f8',
    color:      a ? '#fff'    : '#3a5a8a',
  })

  // 다이어그램 토글 버튼 스타일
  const diagBtn = (type: DiagramType): React.CSSProperties => {
    const active = diagram === type
    const col = DIAGRAM_COLORS[type]
    return {
      border: `1px solid ${active ? col.stroke : '#c0cce0'}`,
      padding:'0.18rem 0.55rem', cursor:'pointer',
      fontSize:'0.65rem', fontWeight:700, fontFamily:'var(--font-mono)', borderRadius:'3px',
      background: active ? col.stroke : '#eef2f8',
      color:      active ? '#fff'     : col.stroke,
    }
  }

  return (
    <div style={{ display:'flex', flex:1, height:'100%', overflow:'hidden' }}>

      {/* ══ 좌: 입력 패널 ══ */}
      <div style={{
        width:'clamp(215px,21%,268px)', flexShrink:0,
        display:'flex', flexDirection:'column',
        borderRight:'1px solid #c8d4e8',
        background:'#f8f9fc', overflow:'hidden',
      }}>
        <div style={{ padding:'0.32rem 0.65rem', background:'#1a3a6a',
          borderBottom:'1px solid #0f2a52',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#c8daf0',
            letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'var(--font-mono)' }}>
            Pier Model
          </span>
          <span style={{ fontSize:'0.58rem', color:'#7aaad8', fontFamily:'var(--font-mono)',
            background:'rgba(255,255,255,0.12)', borderRadius:'2px',
            padding:'0.04rem 0.35rem', fontWeight:700 }}>
            DSM · 2D
          </span>
        </div>

        <div style={{ flex:1, overflowY:'auto' }}>

          <GH title="Pier Geometry" sub="교각 형상"/>
          <Row label="기둥 수">
            <div style={{ display:'flex', gap:'2px', padding:'0.1rem 0' }}>
              {[1,2,3].map(n => (
                <button key={n} onClick={() => setColCount(n)} style={bvLight(geom.colCount===n)}>
                  {n}주
                </button>
              ))}
            </div>
          </Row>
          {geom.colCount > 1 && (
            <Row label="기둥 순간격(m)">
              <Num value={geom.colSpacing} min={1} step={0.5} onChange={v=>updG({colSpacing:v})}/>
            </Row>
          )}
          <Row label="기둥 높이(m)">
            <Num value={geom.colHeight} min={1} step={0.5} onChange={v=>updG({colHeight:v})}/>
          </Row>

          <GH title="Column Section" sub="기둥 단면 (m)"/>
          <Row label="기둥 폭(m)">
            <Num value={geom.colWidth} min={0.3} step={0.1} onChange={v=>updG({colWidth:v})}/>
          </Row>
          <Row label="기둥 깊이(m)">
            <Num value={geom.colDepth} min={0.3} step={0.1} onChange={v=>updG({colDepth:v})}/>
          </Row>

          <GH title="Coping Section" sub="코핑 단면 (m)"/>
          <Row label="중앙 깊이(m)">
            <Num value={geom.copingDepth} min={0.5} step={0.1} onChange={v=>updG({copingDepth:v})}/>
          </Row>
          <Row label="단부 깊이(m)">
            <Num value={geom.copingDepthEnd} min={0.3} step={0.1} onChange={v=>updG({copingDepthEnd:v})}/>
          </Row>
          <Row label="폭 B(m)">
            <Num value={geom.copingWidthB} min={0.5} step={0.1} onChange={v=>updG({copingWidthB:v})}/>
          </Row>

          <GH title="Material" sub="KDS 24 14 21"/>
          <Row label="fck (MPa)">
            <Num value={geom.fck} min={21} step={3} onChange={v=>updG({fck:v})}/>
          </Row>
          <Row label="Ec (MPa)">
            <div style={{ padding:'0.1rem 0.3rem', fontSize:'0.75rem', fontWeight:700,
              fontFamily:'var(--font-mono)', color:'#1a4e80' }}>
              {Math.round(Ec(geom.fck)).toLocaleString()}
            </div>
          </Row>

          {/* 단면 요약 */}
          <div style={{ padding:'0.22rem 0.55rem', background:'#edf2fa',
            borderTop:'1px solid #d0daea', fontSize:'0.62rem',
            fontFamily:'var(--font-mono)', color:'#4a6a9a', lineHeight:1.8 }}>
            <div>기둥 A<sub>g</sub> = {(geom.colWidth*geom.colDepth*1e4).toFixed(0)} cm²</div>
            <div>기둥 I<sub>g</sub> = {(geom.colWidth*Math.pow(geom.colDepth,3)/12*1e8).toFixed(0)} cm⁴</div>
            <div>코핑 A = {(geom.copingWidthB*geom.copingDepth*1e4).toFixed(0)} cm²</div>
            <div>코핑 I = {(geom.copingWidthB*Math.pow(geom.copingDepth,3)/12*1e8).toFixed(0)} cm⁴</div>
            <div>코핑 길이 = {copingW.toFixed(2)} m</div>
            {Math.abs(geom.copingDepth - geom.copingDepthEnd) > 0.01 && (
              <div style={{ color:'#2080c0' }}>변단면: {geom.copingDepthEnd}m → {geom.copingDepth}m → {geom.copingDepthEnd}m</div>
            )}
          </div>

          <GH title="Bearing Loads" sub="받침 하중"/>
          <Row label="받침 수">
            <div style={{ display:'flex', gap:'2px', padding:'0.1rem 0' }}>
              {[1,2,3,4].map(n => (
                <button key={n} onClick={() => syncBearings(n)} style={bvLight(geom.bearingCount===n)}>
                  {n}
                </button>
              ))}
            </div>
          </Row>

          {bearingLoads.slice(0, geom.bearingCount).map((bl, bi) => (
            <div key={bl.id}>
              <div style={{ padding:'0.16rem 0.55rem', background:'#f0f5fc',
                borderBottom:'1px solid #d0daea',
                fontSize:'0.62rem', fontWeight:700, color:'#1a4070',
                fontFamily:'var(--font-mono)', display:'flex', justifyContent:'space-between' }}>
                <span>BRG-{bi+1}</span>
                <span style={{ color:'#8899bb', fontWeight:400, fontSize:'0.58rem' }}>
                  x = {bearingXs[bi]?.toFixed(2)}m
                </span>
              </div>
              <Row label="Fy (kN)">
                <Num value={bl.Fy} step={100}
                  onChange={v=>setBearingLoads(prev=>{const a=[...prev];a[bi]={...a[bi],Fy:v};return a})}/>
              </Row>
              <Row label="Fx (kN)">
                <Num value={bl.Fx} step={10}
                  onChange={v=>setBearingLoads(prev=>{const a=[...prev];a[bi]={...a[bi],Fx:v};return a})}/>
              </Row>
              <Row label="Mz (kN·m)">
                <Num value={bl.Mz} step={10}
                  onChange={v=>setBearingLoads(prev=>{const a=[...prev];a[bi]={...a[bi],Mz:v};return a})}/>
              </Row>
            </div>
          ))}

        </div>
      </div>

      {/* ══ 우: 뷰 영역 ══ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'#f4f6fa' }}>

        {/* 툴바 */}
        <div style={{ padding:'0.3rem 0.7rem', background:'#fff',
          borderBottom:'1px solid #c8d4e8',
          display:'flex', alignItems:'center', gap:'0.4rem', flexShrink:0,
          boxShadow:'0 1px 4px rgba(40,60,100,0.07)' }}>
          <span style={{ fontSize:'0.62rem', color:'#7a8aaa', fontFamily:'var(--font-mono)', marginRight:'0.2rem' }}>VIEW</span>
          <button style={bvTool(activeView==='model')} onClick={()=>setActiveView('model')}>모델</button>
          <button style={bvTool(activeView==='result')} onClick={()=>setActiveView('result')}>결과표</button>
          <div style={{ width:'1px', height:'1rem', background:'#d0daea', margin:'0 0.15rem' }}/>
          <span style={{ fontSize:'0.62rem', color:'#7a8aaa', fontFamily:'var(--font-mono)' }}>DIAGRAM</span>
          <button style={diagBtn('BMD')} onClick={()=>setDiagram(d=>d==='BMD'?'none':'BMD')}>BMD</button>
          <button style={diagBtn('SFD')} onClick={()=>setDiagram(d=>d==='SFD'?'none':'SFD')}>SFD</button>
          <button style={diagBtn('AFD')} onClick={()=>setDiagram(d=>d==='AFD'?'none':'AFD')}>AFD</button>
          <div style={{ width:'1px', height:'1rem', background:'#d0daea', margin:'0 0.15rem' }}/>
          <button style={bvTool(showDeformed)} onClick={()=>setShowDeformed(v=>!v)}>변형</button>
          <div style={{ flex:1 }}/>
          <span style={{ fontSize:'0.6rem', color:'#9aaabb', fontFamily:'var(--font-mono)' }}>
            {nodes.length}N · {members.length}M · {nodes.length*3} DOF
          </span>
        </div>

        {activeView === 'model' && (
          <div style={{ flex:1, overflow:'hidden', padding:'0.6rem', display:'flex', flexDirection:'column', gap:'0.45rem' }}>
            <div style={{ flex:1, minHeight:0 }}>
              <ModelSVG
                nodes={nodes} members={members} result={result}
                geom={geom} copingW={copingW}
                bearingLoads={bearingLoads} bearingXs={bearingXs}
                bearingNodeIds={bearingNodeIds} copingTopY={copingTopY}
                diagram={diagram} showDeformed={showDeformed}/>
            </div>

            {/* Critical Forces */}
            <div style={{ background:'#fff', border:'1px solid #c8d4e8', borderRadius:'4px',
              padding:'0.3rem 0.65rem', flexShrink:0,
              boxShadow:'0 1px 4px rgba(40,60,100,0.07)' }}>
              <div style={{ fontSize:'0.6rem', fontWeight:700, color:'#8899bb',
                fontFamily:'var(--font-mono)', letterSpacing:'0.08em', marginBottom:'0.22rem' }}>
                CRITICAL FORCES
              </div>
              <div style={{ display:'flex', gap:'1.4rem', flexWrap:'wrap' }}>
                {result.memberForces.map((mf, i) => {
                  const mem  = members.find(m => m.id === mf.memberId)
                  const maxM = Math.max(Math.abs(mf.Mi), Math.abs(mf.Mj))
                  const maxV = Math.max(Math.abs(mf.Vi), Math.abs(mf.Vj))
                  const maxN = Math.max(Math.abs(mf.Ni), Math.abs(mf.Nj))
                  return (
                    <div key={mf.memberId} style={{ display:'flex', gap:'0.5rem', alignItems:'baseline' }}>
                      <span style={{ fontSize:'0.62rem', fontWeight:700, color:'#7a8aaa', fontFamily:'var(--font-mono)' }}>
                        {mem?.type==='coping' ? `COP-${i}` : `COL-${i+1}`}
                      </span>
                      <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#c04020', fontFamily:'var(--font-mono)' }}>
                        M={maxM.toFixed(0)}<span style={{ fontSize:'0.57rem', color:'#aaa' }}>kN·m</span>
                      </span>
                      <span style={{ fontSize:'0.7rem', fontWeight:700, color:'#c07010', fontFamily:'var(--font-mono)' }}>
                        V={maxV.toFixed(0)}<span style={{ fontSize:'0.57rem', color:'#aaa' }}>kN</span>
                      </span>
                      <span style={{ fontSize:'0.67rem', color:'#7a9aba', fontFamily:'var(--font-mono)' }}>
                        N={maxN.toFixed(0)}<span style={{ fontSize:'0.57rem', color:'#aaa' }}>kN</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {activeView === 'result' && (
          <div style={{ flex:1, overflow:'hidden' }}>
            <ResultSection result={result} members={members}/>
          </div>
        )}
      </div>
    </div>
  )
}
