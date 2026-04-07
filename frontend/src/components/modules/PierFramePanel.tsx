import { useState, useMemo } from 'react'

// ════════════════════════════════════════════════════════════════
//  2D 교각 골조해석 (Direct Stiffness Method)
//  KDS 24 14 21 : 2021  도로교설계기준
// ════════════════════════════════════════════════════════════════

// ── 타입 정의 ───────────────────────────────────────────────────
interface Node {
  id: number
  x: number   // m
  y: number   // m
  bc: [boolean, boolean, boolean]  // [Dx, Dy, Rz] 고정여부
}

interface Member {
  id: number
  ni: number   // 시작절점 id
  nj: number   // 끝절점 id
  E: number    // MPa
  A: number    // mm²
  I: number    // mm⁴
  type: 'coping' | 'column'
}

interface PointLoad {
  nodeId: number
  Fx: number   // kN
  Fy: number   // kN
  Mz: number   // kN·m
}

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
  copingDepth: number   // m
  colWidth: number      // m
  colDepth: number      // m
  fck: number           // MPa
  bearingCount: number
}

interface BearingLoad {
  id: number
  Fy: number   // kN
  Fx: number   // kN
  Mz: number   // kN·m
}

const DEFAULT_GEOM: PierGeom = {
  colCount: 2, colSpacing: 6.0, colHeight: 8.0,
  copingDepth: 1.5, colWidth: 1.2, colDepth: 1.5,
  fck: 30, bearingCount: 2,
}

const DEFAULT_BEARING_LOADS: BearingLoad[] = [
  { id: 1, Fy: 2500, Fx: 80, Mz: 0 },
  { id: 2, Fy: 2500, Fx: 80, Mz: 0 },
]

// ── 콘크리트 탄성계수 ────────────────────────────────────────────
function Ec(fck: number) { return 8500 * Math.pow(fck + 4, 1/3) }

// ── 골조 모델 생성 ───────────────────────────────────────────────
function buildModel(geom: PierGeom, bearingLoads: BearingLoad[]) {
  const { colCount, colSpacing, colHeight, copingDepth, colWidth, colDepth, fck } = geom
  const E = Ec(fck)

  const totalColSpan = colCount > 1 ? (colCount - 1) * colSpacing : 0
  const copingW = totalColSpan + colWidth * 2

  const Ac = colWidth * colDepth * 1e6          // mm²
  const Ic = colWidth * Math.pow(colDepth, 3) / 12 * 1e12  // mm⁴
  const Acop = copingW * copingDepth * 1e6
  const Icop = copingW * Math.pow(copingDepth, 3) / 12 * 1e12

  const nodes: Node[] = []
  let nid = 1

  const colXs: number[] = []
  for (let i = 0; i < colCount; i++) {
    colXs.push((i - (colCount - 1) / 2) * colSpacing)
  }

  const baseNodeIds: number[] = []
  for (const x of colXs) {
    nodes.push({ id: nid, x, y: 0, bc: [true, true, true] })
    baseNodeIds.push(nid++)
  }

  const topNodeIds: number[] = []
  for (const x of colXs) {
    nodes.push({ id: nid, x, y: colHeight, bc: [false, false, false] })
    topNodeIds.push(nid++)
  }

  const members: Member[] = []
  let mid = 1

  for (let i = 0; i < colCount; i++) {
    members.push({ id: mid++, ni: baseNodeIds[i], nj: topNodeIds[i], E, A: Ac, I: Ic, type: 'column' })
  }
  for (let i = 0; i < colCount - 1; i++) {
    members.push({ id: mid++, ni: topNodeIds[i], nj: topNodeIds[i + 1], E, A: Acop, I: Icop, type: 'coping' })
  }

  // 받침 하중 → 가장 가까운 기둥 상단 절점에 분배
  const pointLoads: PointLoad[] = []
  const count = geom.bearingCount
  const bearingXs = count === 1
    ? [0]
    : Array.from({length:count},(_,i)=>(i-(count-1)/2)*(copingW/count))

  for (let bi = 0; bi < Math.min(bearingLoads.length, count); bi++) {
    const bx = bearingXs[bi]
    const load = bearingLoads[bi]
    let minDist = Infinity, targetNid = topNodeIds[0]
    for (let i = 0; i < colCount; i++) {
      const dist = Math.abs(colXs[i] - bx)
      if (dist < minDist) { minDist = dist; targetNid = topNodeIds[i] }
    }
    const existing = pointLoads.find(p => p.nodeId === targetNid)
    if (existing) {
      existing.Fx += load.Fx; existing.Fy += load.Fy; existing.Mz += load.Mz
    } else {
      pointLoads.push({ nodeId: targetNid, Fx: load.Fx, Fy: load.Fy, Mz: load.Mz })
    }
  }

  return { nodes, members, pointLoads, copingW, colXs, baseNodeIds, topNodeIds, bearingXs }
}

// ── Direct Stiffness Method ──────────────────────────────────────
function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map(row => row[j]))
}
function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0].length, p = B.length
  return Array.from({length:n},(_,i)=>Array.from({length:m},(__,j)=>
    Array.from({length:p},(___, k)=>A[i][k]*B[k][j]).reduce((a,b)=>a+b,0)))
}
function matVec(A: number[][], v: number[]): number[] {
  return A.map(row=>row.reduce((s,a,j)=>s+a*v[j],0))
}
function gaussElim(Kin: number[][], Fin: number[]): number[] {
  const n = Fin.length
  const A = Kin.map((r,i)=>[...r,Fin[i]])
  for (let col=0;col<n;col++){
    let maxRow=col
    for (let r=col+1;r<n;r++) if(Math.abs(A[r][col])>Math.abs(A[maxRow][col])) maxRow=r
    ;[A[col],A[maxRow]]=[A[maxRow],A[col]]
    if(Math.abs(A[col][col])<1e-14) continue
    for(let r=col+1;r<n;r++){
      const f=A[r][col]/A[col][col]
      for(let c=col;c<=n;c++) A[r][c]-=f*A[col][c]
    }
  }
  const x=new Array(n).fill(0)
  for(let i=n-1;i>=0;i--){
    x[i]=A[i][n]
    for(let j=i+1;j<n;j++) x[i]-=A[i][j]*x[j]
    x[i]/=A[i][i]||1
  }
  return x
}

function solveFrame(nodes: Node[], members: Member[], pointLoads: PointLoad[]): AnalysisResult {
  const nDOF = nodes.length * 3
  const nodeIdx = new Map(nodes.map((n,i)=>[n.id,i]))
  const K = Array.from({length:nDOF},()=>new Array(nDOF).fill(0))
  const F = new Array(nDOF).fill(0)

  for (const m of members) {
    const ni = nodeIdx.get(m.ni)!, nj = nodeIdx.get(m.nj)!
    const xi=nodes[ni].x,yi=nodes[ni].y,xj=nodes[nj].x,yj=nodes[nj].y
    const L=Math.sqrt((xj-xi)**2+(yj-yi)**2)
    if(L<1e-12) continue
    const EA=m.E*1e3*m.A*1e-6
    const EI=m.E*1e3*m.I*1e-12
    const c=(xj-xi)/L, s=(yj-yi)/L

    const kL:number[][]=[
      [EA/L,0,0,-EA/L,0,0],
      [0,12*EI/L**3,6*EI/L**2,0,-12*EI/L**3,6*EI/L**2],
      [0,6*EI/L**2,4*EI/L,0,-6*EI/L**2,2*EI/L],
      [-EA/L,0,0,EA/L,0,0],
      [0,-12*EI/L**3,-6*EI/L**2,0,12*EI/L**3,-6*EI/L**2],
      [0,6*EI/L**2,2*EI/L,0,-6*EI/L**2,4*EI/L],
    ]
    const T:number[][]=Array.from({length:6},()=>new Array(6).fill(0))
    T[0][0]=c;T[0][1]=s;T[1][0]=-s;T[1][1]=c;T[2][2]=1
    T[3][3]=c;T[3][4]=s;T[4][3]=-s;T[4][4]=c;T[5][5]=1
    const kG=matMul(matMul(transpose(T),kL),T)
    const dofs=[ni*3,ni*3+1,ni*3+2,nj*3,nj*3+1,nj*3+2]
    for(let r=0;r<6;r++) for(let cc=0;cc<6;cc++) K[dofs[r]][dofs[cc]]+=kG[r][cc]
  }

  for(const pl of pointLoads){
    const ni=nodeIdx.get(pl.nodeId)!
    F[ni*3]+=pl.Fx; F[ni*3+1]+=pl.Fy; F[ni*3+2]+=pl.Mz
  }

  const PENALTY=1e15
  for(const node of nodes){
    const ni=nodeIdx.get(node.id)!
    const [bx,by,br]=node.bc
    if(bx) K[ni*3][ni*3]+=PENALTY
    if(by) K[ni*3+1][ni*3+1]+=PENALTY
    if(br) K[ni*3+2][ni*3+2]+=PENALTY
  }

  const U=gaussElim(K,F)

  const reactions=nodes
    .filter(n=>n.bc.some(Boolean))
    .map(n=>{
      const ni=nodeIdx.get(n.id)!
      const [bx,by,br]=n.bc
      return {
        nodeId:n.id,
        Fx:bx?PENALTY*U[ni*3]:0,
        Fy:by?PENALTY*U[ni*3+1]:0,
        Mz:br?PENALTY*U[ni*3+2]:0,
      }
    })

  const memberForces=members.map(m=>{
    const ni=nodeIdx.get(m.ni)!, nj=nodeIdx.get(m.nj)!
    const xi=nodes[ni].x,yi=nodes[ni].y,xj=nodes[nj].x,yj=nodes[nj].y
    const L=Math.sqrt((xj-xi)**2+(yj-yi)**2)
    if(L<1e-12) return {memberId:m.id,Ni:0,Vi:0,Mi:0,Nj:0,Vj:0,Mj:0}
    const EA=m.E*1e3*m.A*1e-6, EI=m.E*1e3*m.I*1e-12
    const c=(xj-xi)/L, s=(yj-yi)/L
    const kL:number[][]=[
      [EA/L,0,0,-EA/L,0,0],
      [0,12*EI/L**3,6*EI/L**2,0,-12*EI/L**3,6*EI/L**2],
      [0,6*EI/L**2,4*EI/L,0,-6*EI/L**2,2*EI/L],
      [-EA/L,0,0,EA/L,0,0],
      [0,-12*EI/L**3,-6*EI/L**2,0,12*EI/L**3,-6*EI/L**2],
      [0,6*EI/L**2,2*EI/L,0,-6*EI/L**2,4*EI/L],
    ]
    const T:number[][]=Array.from({length:6},()=>new Array(6).fill(0))
    T[0][0]=c;T[0][1]=s;T[1][0]=-s;T[1][1]=c;T[2][2]=1
    T[3][3]=c;T[3][4]=s;T[4][3]=-s;T[4][4]=c;T[5][5]=1
    const uG=[U[ni*3],U[ni*3+1],U[ni*3+2],U[nj*3],U[nj*3+1],U[nj*3+2]]
    const uL=matVec(T,uG)
    const fL=matVec(kL,uL)
    return {memberId:m.id,Ni:fL[0],Vi:fL[1],Mi:fL[2],Nj:fL[3],Vj:fL[4],Mj:fL[5]}
  })

  return {U,reactions,memberForces}
}

// ── UI 헬퍼 ─────────────────────────────────────────────────────
function GH({title,sub}:{title:string;sub?:string}) {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'0.28rem 0.6rem',background:'var(--surface-3)',
      borderBottom:'1px solid var(--border-dark)',borderTop:'1px solid var(--border-dark)',marginTop:'0.15rem'}}>
      <span style={{fontSize:'0.7rem',fontWeight:700,color:'var(--text-2)',letterSpacing:'0.04em',fontFamily:'var(--font-mono)'}}>{title}</span>
      {sub&&<span style={{fontSize:'0.6rem',color:'var(--text-disabled)',fontFamily:'var(--font-mono)'}}>{sub}</span>}
    </div>
  )
}
function Row({label,children}:{label:string;children:React.ReactNode}) {
  return (
    <div style={{display:'grid',gridTemplateColumns:'8rem 1fr',alignItems:'center',borderBottom:'1px solid var(--border-light)',minHeight:'1.85rem'}}>
      <div style={{fontSize:'0.7rem',fontWeight:600,color:'var(--text-2)',padding:'0.2rem 0.5rem',
        borderRight:'1px solid var(--border-light)',background:'var(--surface-2)',
        height:'100%',display:'flex',alignItems:'center',whiteSpace:'nowrap',fontFamily:'var(--font-mono)'}}>{label}</div>
      <div style={{padding:'0.15rem 0.3rem'}}>{children}</div>
    </div>
  )
}
function Num({value,min,max,step=1,onChange}:{value:number;min?:number;max?:number;step?:number;onChange:(v:number)=>void}) {
  return (
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e=>onChange(Number(e.target.value))}
      style={{width:'100%',fontSize:'0.78rem',fontFamily:'var(--font-mono)',padding:'0.1rem 0.25rem'}}/>
  )
}

// ── 2D 모델링 SVG ────────────────────────────────────────────────
interface ModelSVGProps {
  nodes: Node[]; members: Member[]; result: AnalysisResult | null
  colHeight: number; copingW: number; copingDepth: number; geom: PierGeom
  bearingLoads: BearingLoad[]; bearingXs: number[]
  showBMD: boolean; showDeformed: boolean
}

function ModelSVG({nodes,members,result,colHeight,copingW,copingDepth,geom,bearingLoads,bearingXs,showBMD,showDeformed}:ModelSVGProps) {
  const VW=720,VH=520
  const PAD={l:72,r:36,t:56,b:64}
  const W=VW-PAD.l-PAD.r, H=VH-PAD.t-PAD.b

  const margin=Math.max(copingW*0.25,1.8)
  const xMin=-copingW/2-margin, xMax=copingW/2+margin
  const yMin=-1.4, yMax=colHeight+copingDepth+2.2

  const sx=(x:number)=>PAD.l+(x-xMin)/(xMax-xMin)*W
  const sy=(y:number)=>PAD.t+H-(y-yMin)/(yMax-yMin)*H

  // 부재력 최대값
  const mfArr=result?.memberForces??[]
  const maxAbsM=Math.max(...mfArr.flatMap(mf=>[Math.abs(mf.Mi),Math.abs(mf.Mj)]),1)
  const bmdScale=(H*0.20)/maxAbsM

  // 부재 폭 (화면 픽셀 기준)
  const colPxW=Math.max((geom.colWidth/(xMax-xMin))*W,8)
  const copPxH=Math.max((copingDepth/(yMax-yMin))*H,8)

  const nodeMap=new Map(nodes.map(n=>[n.id,n]))

  // BMD 경로 생성
  function bmdPath(_m:Member,ni:Node,nj:Node,mf:typeof mfArr[0]):string {
    const L=Math.sqrt((nj.x-ni.x)**2+(nj.y-ni.y)**2)
    const nx=-(nj.y-ni.y)/L, ny=(nj.x-ni.x)/L
    const pts=24
    const coords:string[]=[]
    for(let i=0;i<=pts;i++){
      const t=i/pts
      // 선형보간 (집중하중만 있으므로 선형 BMD)
      const M=mf.Mi*(1-t)+(-mf.Mj)*t
      const px=ni.x+t*(nj.x-ni.x)+M*bmdScale*nx
      const py=ni.y+t*(nj.y-ni.y)+M*bmdScale*ny
      coords.push(`${i===0?'M':'L'}${sx(px).toFixed(1)},${sy(py).toFixed(1)}`)
    }
    coords.push(`L${sx(nj.x).toFixed(1)},${sy(nj.y).toFixed(1)}`)
    coords.push(`L${sx(ni.x).toFixed(1)},${sy(ni.y).toFixed(1)}`)
    coords.push('Z')
    return coords.join(' ')
  }

  // 변형 배율
  const maxU=result?Math.max(...result.U.map(Math.abs),1e-9):1e-9
  const defScale=Math.min((H*0.04)/maxU,5e6)

  // 눈금 생성
  const xRange=xMax-xMin, yRange=yMax-yMin
  const xStep=xRange>10?2:xRange>5?1:0.5
  const yStep=yRange>10?2:yRange>5?1:0.5
  const xTicks:number[]=[], yTicks:number[]=[]
  for(let v=Math.ceil(xMin/xStep)*xStep;v<=xMax+0.01;v+=xStep) xTicks.push(+v.toFixed(2))
  for(let v=Math.ceil(yMin/yStep)*yStep;v<=yMax+0.01;v+=yStep) yTicks.push(+v.toFixed(2))

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%"
      style={{display:'block',background:'#16202e',borderRadius:'4px',userSelect:'none'}}>
      <defs>
        <pattern id="grid-sm" width="1" height="1" patternUnits="userSpaceOnUse"
          patternTransform={`scale(${W/(xMax-xMin)},${H/(yMax-yMin)}) translate(${-xMin},${-yMin})`}>
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#ffffff07" strokeWidth={0.02}/>
        </pattern>
        <linearGradient id="col-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2a5fa8"/><stop offset="100%" stopColor="#3a7ac8"/>
        </linearGradient>
        <linearGradient id="cop-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a7ac8"/><stop offset="100%" stopColor="#2a5fa8"/>
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <marker id="arr-load" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <polygon points="0,0 7,3.5 0,7" fill="#f0a020"/>
        </marker>
        <marker id="arr-rxn" markerWidth="7" markerHeight="7" refX="2" refY="3.5" orient="auto">
          <polygon points="7,0 0,3.5 7,7" fill="#54d98c"/>
        </marker>
        <marker id="arr-dim" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <line x1="0" y1="0" x2="6" y2="6" stroke="#667799" strokeWidth="1.2"/>
          <line x1="0" y1="6" x2="6" y2="0" stroke="#667799" strokeWidth="1.2"/>
        </marker>
      </defs>

      {/* 배경 */}
      <rect x={PAD.l} y={PAD.t} width={W} height={H} fill="#16202e"/>
      <rect x={PAD.l} y={PAD.t} width={W} height={H} fill="url(#grid-sm)" opacity="0.6"/>

      {/* 축 */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t+H} stroke="#334455" strokeWidth="1"/>
      <line x1={PAD.l} y1={PAD.t+H} x2={PAD.l+W} y2={PAD.t+H} stroke="#334455" strokeWidth="1"/>

      {/* x 눈금 */}
      {xTicks.map(v=>(
        <g key={`xt-${v}`}>
          <line x1={sx(v)} y1={PAD.t+H} x2={sx(v)} y2={PAD.t+H+4} stroke="#445566" strokeWidth="1"/>
          <text x={sx(v)} y={PAD.t+H+14} textAnchor="middle" fill="#556677" fontSize="9" fontFamily="JetBrains Mono,monospace">{v}</text>
          <line x1={sx(v)} y1={PAD.t} x2={sx(v)} y2={PAD.t+H} stroke="#ffffff05" strokeWidth="0.5"/>
        </g>
      ))}
      {/* y 눈금 */}
      {yTicks.map(v=>(
        <g key={`yt-${v}`}>
          <line x1={PAD.l-4} y1={sy(v)} x2={PAD.l} y2={sy(v)} stroke="#445566" strokeWidth="1"/>
          <text x={PAD.l-8} y={sy(v)+4} textAnchor="end" fill="#556677" fontSize="9" fontFamily="JetBrains Mono,monospace">{v}</text>
          <line x1={PAD.l} y1={sy(v)} x2={PAD.l+W} y2={sy(v)} stroke="#ffffff05" strokeWidth="0.5"/>
        </g>
      ))}
      {/* 축 라벨 */}
      <text x={PAD.l+W/2} y={VH-6} textAnchor="middle" fill="#445566" fontSize="9" fontFamily="JetBrains Mono,monospace">x (m)</text>
      <text x={10} y={PAD.t+H/2} textAnchor="middle" fill="#445566" fontSize="9" fontFamily="JetBrains Mono,monospace"
        transform={`rotate(-90,10,${PAD.t+H/2})`}>y (m)</text>

      {/* 지반선 */}
      <line x1={PAD.l} y1={sy(0)} x2={PAD.l+W} y2={sy(0)} stroke="#3a5a80" strokeWidth="1.5" strokeDasharray="8,4"/>
      {Array.from({length:Math.floor(W/20)+1},(_,i)=>(
        <line key={i} x1={PAD.l+i*20} y1={sy(0)} x2={PAD.l+i*20-8} y2={sy(0)+11}
          stroke="#2a4a6a" strokeWidth="1"/>
      ))}
      <text x={PAD.l+8} y={sy(0)-4} fill="#3a5a80" fontSize="8" fontFamily="JetBrains Mono,monospace">GL ±0.000</text>

      {/* BMD */}
      {showBMD&&result&&members.map(m=>{
        const mf=result.memberForces.find(f=>f.memberId===m.id)
        const ni=nodeMap.get(m.ni),nj=nodeMap.get(m.nj)
        if(!mf||!ni||!nj) return null
        return (
          <g key={`bmd-${m.id}`}>
            <path d={bmdPath(m,ni,nj,mf)} fill="rgba(80,140,255,0.15)" stroke="#5080ff" strokeWidth="1.2"/>
            {/* 최대 모멘트 값 표기 */}
            {[{t:0,M:mf.Mi},{t:1,M:-mf.Mj}].map(({t,M},vi)=>{
              if(Math.abs(M)<1) return null
              const L=Math.sqrt((nj.x-ni.x)**2+(nj.y-ni.y)**2)
              const nx2=-(nj.y-ni.y)/L,ny2=(nj.x-ni.x)/L
              const px=ni.x+t*(nj.x-ni.x)+M*bmdScale*nx2
              const py=ni.y+t*(nj.y-ni.y)+M*bmdScale*ny2
              return (
                <text key={vi} x={sx(px)+(m.type==='column'?6:0)} y={sy(py)+(m.type==='coping'?-6:0)}
                  fill="#6090ff" fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700">
                  {Math.abs(M).toFixed(0)}
                </text>
              )
            })}
          </g>
        )
      })}

      {/* 변형 형상 */}
      {showDeformed&&result&&members.map(m=>{
        const ni=nodeMap.get(m.ni)!,nj=nodeMap.get(m.nj)!
        const nii=nodes.findIndex(n=>n.id===m.ni),nij=nodes.findIndex(n=>n.id===m.nj)
        const dxi=result.U[nii*3]*defScale,dyi=result.U[nii*3+1]*defScale
        const dxj=result.U[nij*3]*defScale,dyj=result.U[nij*3+1]*defScale
        return (
          <line key={`def-${m.id}`}
            x1={sx(ni.x+dxi)} y1={sy(ni.y+dyi)}
            x2={sx(nj.x+dxj)} y2={sy(nj.y+dyj)}
            stroke="#ffcc44" strokeWidth="1.8" strokeDasharray="6,3" opacity="0.75"/>
        )
      })}

      {/* 기둥 단면 (직사각형) */}
      {members.filter(m=>m.type==='column').map(m=>{
        const ni=nodeMap.get(m.ni)!,nj=nodeMap.get(m.nj)!
        return (
          <rect key={`csec-${m.id}`}
            x={sx(nj.x)-colPxW/2} y={sy(nj.y)}
            width={colPxW} height={sy(ni.y)-sy(nj.y)}
            fill="url(#col-grad)" stroke="#5090d0" strokeWidth="1.2" rx="1" opacity="0.88"/>
        )
      })}

      {/* 코핑 단면 */}
      {members.filter(m=>m.type==='coping').map(m=>{
        const ni=nodeMap.get(m.ni)!,nj=nodeMap.get(m.nj)!
        const lx=Math.min(sx(ni.x),sx(nj.x))
        const rx=Math.max(sx(ni.x),sx(nj.x))
        // 코핑은 기둥 상단 절점 사이보다 좌우로 돌출
        const overhang=(geom.colWidth/(xMax-xMin))*W
        return (
          <rect key={`cop-${m.id}`}
            x={lx-overhang} y={sy(colHeight+copingDepth)}
            width={rx-lx+overhang*2} height={copPxH}
            fill="url(#cop-grad)" stroke="#5090d0" strokeWidth="1.2" rx="1" opacity="0.88"/>
        )
      })}
      {/* 1주 기둥일 때 코핑 (별도 처리) */}
      {geom.colCount===1&&(()=>{
        const topNode=nodeMap.get(nodes.find(n=>n.y===colHeight)?.id??-1)
        if(!topNode) return null
        const cx=sx(topNode.x)
        const copHalfW=(copingW/(xMax-xMin))*W/2
        return (
          <rect x={cx-copHalfW} y={sy(colHeight+copingDepth)}
            width={copHalfW*2} height={copPxH}
            fill="url(#cop-grad)" stroke="#5090d0" strokeWidth="1.2" rx="1" opacity="0.88"/>
        )
      })()}

      {/* 부재 중심선 */}
      {members.map(m=>{
        const ni=nodeMap.get(m.ni)!,nj=nodeMap.get(m.nj)!
        return (
          <line key={`cl-${m.id}`}
            x1={sx(ni.x)} y1={sy(ni.y)} x2={sx(nj.x)} y2={sy(nj.y)}
            stroke="#ffffff18" strokeWidth="1" strokeDasharray="3,4"/>
        )
      })}

      {/* 받침 심볼 + 하중 화살표 */}
      {bearingXs.map((bx,bi)=>{
        const load=bearingLoads[bi]
        if(!load) return null
        const by=colHeight+copingDepth
        const sbx=sx(bx),sby=sy(by)
        const maxFy=Math.max(...bearingLoads.map(b=>b.Fy),1)
        const arrowLen=30+Math.abs(load.Fy)/maxFy*35
        const hLen=Math.min(Math.abs(load.Fx)/200*25+10,40)
        return (
          <g key={`b-${bi}`}>
            {/* 받침 박스 */}
            <rect x={sbx-10} y={sby-14} width="20" height="14"
              fill="#2a3850" stroke="#f0a020" strokeWidth="1.2" rx="1"/>
            <line x1={sbx-10} y1={sby-7} x2={sbx+10} y2={sby-7}
              stroke="#f0a02050" strokeWidth="0.8"/>
            {/* 삼각형 */}
            <polygon points={`${sbx},${sby} ${sbx-9},${sby+10} ${sbx+9},${sby+10}`}
              fill="none" stroke="#f0a020" strokeWidth="1.2"/>
            <line x1={sbx-12} y1={sby+10} x2={sbx+12} y2={sby+10}
              stroke="#f0a020" strokeWidth="1.5"/>
            {/* 수직 하중 */}
            <line x1={sbx} y1={sby-14-arrowLen} x2={sbx} y2={sby-14}
              stroke="#f0a020" strokeWidth="2" markerEnd="url(#arr-load)"/>
            <text x={sbx+5} y={sby-14-arrowLen/2+4}
              fill="#ffcc60" fontSize="10" fontFamily="JetBrains Mono,monospace" fontWeight="700">
              {load.Fy}
            </text>
            <text x={sbx+5} y={sby-14-arrowLen/2+14}
              fill="#f0a02080" fontSize="8" fontFamily="JetBrains Mono,monospace">kN</text>
            {/* 수평 하중 */}
            {Math.abs(load.Fx)>0.1&&(
              <>
                <line
                  x1={load.Fx>0?sbx-hLen:sbx+hLen} y1={sby-20}
                  x2={sbx} y2={sby-20}
                  stroke="#e07030" strokeWidth="1.8" markerEnd="url(#arr-load)"/>
                <text x={load.Fx>0?sbx-hLen-2:sbx+hLen+2} y={sby-24}
                  textAnchor={load.Fx>0?'end':'start'}
                  fill="#e07030" fontSize="9" fontFamily="JetBrains Mono,monospace">
                  {load.Fx}kN
                </text>
              </>
            )}
            {/* 받침 번호 */}
            <text x={sbx} y={sby-2} textAnchor="middle"
              fill="#f0a020" fontSize="8" fontFamily="JetBrains Mono,monospace" fontWeight="700">
              BRG{bi+1}
            </text>
          </g>
        )
      })}

      {/* 절점 */}
      {nodes.map(n=>{
        const isFixed=n.bc.some(Boolean)
        return (
          <g key={`nd-${n.id}`}>
            {isFixed?(
              <>
                <rect x={sx(n.x)-12} y={sy(n.y)} width="24" height="10"
                  fill="#1e3050" stroke="#4a6a9a" strokeWidth="1.2" rx="1"/>
                {Array.from({length:5},(_,i)=>(
                  <line key={i} x1={sx(n.x)-10+i*5} y1={sy(n.y)+10}
                    x2={sx(n.x)-13+i*5} y2={sy(n.y)+18}
                    stroke="#4a6a9a" strokeWidth="1.2"/>
                ))}
              </>
            ):(
              <circle cx={sx(n.x)} cy={sy(n.y)} r="5"
                fill="#16202e" stroke="#60a0e0" strokeWidth="2"/>
            )}
            <text x={sx(n.x)+8} y={sy(n.y)-5}
              fill="#5080a0" fontSize="8" fontFamily="JetBrains Mono,monospace">
              N{n.id}
            </text>
          </g>
        )
      })}

      {/* 반력 화살표 */}
      {result&&result.reactions.map(r=>{
        const n=nodeMap.get(r.nodeId)!
        const scale=0.012
        const ryLen=Math.min(Math.abs(r.Fy)*scale,45)+10
        const rxLen=Math.min(Math.abs(r.Fx)*scale,30)+6
        return (
          <g key={`rxn-${r.nodeId}`}>
            {Math.abs(r.Fy)>5&&(
              <>
                <line x1={sx(n.x)} y1={sy(n.y)+20} x2={sx(n.x)} y2={sy(n.y)+20+ryLen}
                  stroke="#54d98c" strokeWidth="1.8" markerEnd="url(#arr-rxn)"/>
                <text x={sx(n.x)+5} y={sy(n.y)+20+ryLen/2+4}
                  fill="#54d98c" fontSize="9" fontFamily="JetBrains Mono,monospace">
                  {r.Fy.toFixed(0)}
                </text>
              </>
            )}
            {Math.abs(r.Fx)>5&&(
              <line x1={sx(n.x)+(r.Fx>0?rxLen:-rxLen)} y1={sy(n.y)+14}
                    x2={sx(n.x)} y2={sy(n.y)+14}
                stroke="#54d98c" strokeWidth="1.5" markerEnd="url(#arr-rxn)"/>
            )}
          </g>
        )
      })}

      {/* 치수선 — 기둥 높이 */}
      {(()=>{
        const lx=PAD.l+14
        const y0=sy(0),y1=sy(colHeight)
        return (
          <g>
            <line x1={lx} y1={y0} x2={lx} y2={y1} stroke="#557799" strokeWidth="1"/>
            <line x1={lx-4} y1={y0} x2={lx+4} y2={y0} stroke="#557799" strokeWidth="1"/>
            <line x1={lx-4} y1={y1} x2={lx+4} y2={y1} stroke="#557799" strokeWidth="1"/>
            <text x={lx-6} y={(y0+y1)/2+4} textAnchor="middle"
              fill="#557799" fontSize="9" fontFamily="JetBrains Mono,monospace"
              transform={`rotate(-90,${lx-6},${(y0+y1)/2})`}>
              H={colHeight}m
            </text>
          </g>
        )
      })()}

      {/* 부재 라벨 */}
      {members.map((m,idx)=>{
        const ni=nodeMap.get(m.ni)!,nj=nodeMap.get(m.nj)!
        const mx=(ni.x+nj.x)/2,my=(ni.y+nj.y)/2
        const isCop=m.type==='coping'
        return (
          <text key={`ml-${m.id}`}
            x={sx(mx)+(isCop?0:colPxW/2+4)} y={sy(my)+(isCop?-copPxH/2-6:0)}
            fill="#3a6a9a" fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700">
            {isCop?`COP-${idx}`:`COL-${idx+1}`}
          </text>
        )
      })}

      {/* 타이틀 */}
      <text x={PAD.l} y={PAD.t-10} fill="#3a5a7a" fontSize="11" fontFamily="JetBrains Mono,monospace" fontWeight="700">
        2D PIER FRAME  ·  DSM
      </text>
      {showBMD&&<text x={PAD.l+W-4} y={PAD.t-10} textAnchor="end"
        fill="#5080ff" fontSize="9" fontFamily="JetBrains Mono,monospace">BMD</text>}
      {showDeformed&&<text x={PAD.l+W-44} y={PAD.t-10} textAnchor="end"
        fill="#ffcc44" fontSize="9" fontFamily="JetBrains Mono,monospace">DEFORMED</text>}
    </svg>
  )
}

// ── 결과 테이블 ──────────────────────────────────────────────────
function ResultSection({result,members}:{result:AnalysisResult;members:Member[]}) {
  const [tab,setTab]=useState<'member'|'reaction'>('member')
  const tb=(a:boolean):React.CSSProperties=>({
    border:'none',padding:'0.22rem 0.75rem',fontSize:'0.65rem',fontWeight:700,
    fontFamily:'var(--font-mono)',cursor:'pointer',
    background:a?'var(--primary)':'var(--surface-3)',color:a?'#fff':'var(--text-3)',
    borderRadius:'2px 2px 0 0',
  })
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <div style={{display:'flex',gap:'2px',padding:'0.3rem 0.4rem 0',
        background:'var(--surface-2)',borderBottom:'1px solid var(--border-dark)'}}>
        <button style={tb(tab==='member')} onClick={()=>setTab('member')}>부재력</button>
        <button style={tb(tab==='reaction')} onClick={()=>setTab('reaction')}>반력</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'0.4rem'}}>
        {tab==='member'&&(
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.68rem',fontFamily:'var(--font-mono)'}}>
            <thead>
              <tr style={{background:'var(--surface-3)'}}>
                {['부재','유형','Ni(kN)','Vi(kN)','Mi(kN·m)','Nj(kN)','Vj(kN)','Mj(kN·m)'].map(h=>(
                  <th key={h} style={{padding:'0.25rem 0.4rem',borderBottom:'2px solid var(--border-dark)',
                    color:'var(--text-2)',fontWeight:700,textAlign:h==='부재'||h==='유형'?'left':'right',whiteSpace:'nowrap'}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.memberForces.map((mf,i)=>{
                const mem=members.find(m=>m.id===mf.memberId)
                const isCop=mem?.type==='coping'
                const maxM=Math.max(Math.abs(mf.Mi),Math.abs(mf.Mj))
                return (
                  <tr key={mf.memberId} style={{background:i%2===0?'var(--surface)':'var(--surface-2)'}}>
                    <td style={{padding:'0.22rem 0.4rem',fontWeight:700,color:'var(--text-2)'}}>
                      {isCop?`COP-${i}`:`COL-${i+1}`}
                    </td>
                    <td style={{padding:'0.22rem 0.4rem'}}>
                      <span style={{fontSize:'0.6rem',padding:'0.05rem 0.35rem',borderRadius:'2px',fontWeight:700,
                        background:isCop?'var(--primary-bg)':'var(--surface-3)',
                        color:isCop?'var(--primary)':'var(--text-3)'}}>
                        {isCop?'COPING':'COLUMN'}
                      </span>
                    </td>
                    {[mf.Ni,mf.Vi,mf.Mi,mf.Nj,mf.Vj,mf.Mj].map((v,vi)=>(
                      <td key={vi} style={{padding:'0.22rem 0.4rem',textAlign:'right',
                        color:vi===2||vi===5
                          ?maxM>3000?'var(--danger)':maxM>1500?'var(--warning)':'var(--success)'
                          :'var(--text)'}}>
                        {isFinite(v)?v.toFixed(1):'—'}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {tab==='reaction'&&(
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.68rem',fontFamily:'var(--font-mono)'}}>
            <thead>
              <tr style={{background:'var(--surface-3)'}}>
                {['절점','Rx(kN)','Ry(kN)','Rm(kN·m)'].map(h=>(
                  <th key={h} style={{padding:'0.25rem 0.5rem',borderBottom:'2px solid var(--border-dark)',
                    color:'var(--text-2)',fontWeight:700,textAlign:h==='절점'?'left':'right'}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.reactions.map((r,i)=>(
                <tr key={r.nodeId} style={{background:i%2===0?'var(--surface)':'var(--surface-2)'}}>
                  <td style={{padding:'0.22rem 0.5rem',fontWeight:700,color:'var(--text-2)'}}>N{r.nodeId}</td>
                  <td style={{padding:'0.22rem 0.5rem',textAlign:'right',color:Math.abs(r.Fx)>5?'var(--warning)':'var(--text-3)'}}>{r.Fx.toFixed(1)}</td>
                  <td style={{padding:'0.22rem 0.5rem',textAlign:'right',color:'var(--text)'}}>{r.Fy.toFixed(1)}</td>
                  <td style={{padding:'0.22rem 0.5rem',textAlign:'right',color:Math.abs(r.Mz)>5?'var(--primary)':'var(--text-3)'}}>{r.Mz.toFixed(1)}</td>
                </tr>
              ))}
              <tr style={{background:'var(--surface-3)',borderTop:'2px solid var(--border-dark)'}}>
                <td style={{padding:'0.22rem 0.5rem',fontWeight:700,color:'var(--text-2)'}}>Σ</td>
                <td style={{padding:'0.22rem 0.5rem',textAlign:'right',fontWeight:700}}>{result.reactions.reduce((s,r)=>s+r.Fx,0).toFixed(1)}</td>
                <td style={{padding:'0.22rem 0.5rem',textAlign:'right',fontWeight:700}}>{result.reactions.reduce((s,r)=>s+r.Fy,0).toFixed(1)}</td>
                <td style={{padding:'0.22rem 0.5rem',textAlign:'right',fontWeight:700}}>{result.reactions.reduce((s,r)=>s+r.Mz,0).toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── 메인 패널 ────────────────────────────────────────────────────
export default function PierFramePanel() {
  const [geom,setGeom]=useState<PierGeom>(DEFAULT_GEOM)
  const [bearingLoads,setBearingLoads]=useState<BearingLoad[]>(DEFAULT_BEARING_LOADS)
  const [showBMD,setShowBMD]=useState(true)
  const [showDeformed,setShowDeformed]=useState(false)
  const [activeView,setActiveView]=useState<'model'|'result'>('model')

  const updG=(patch:Partial<PierGeom>)=>setGeom(g=>({...g,...patch}))

  const syncBearings=(count:number)=>{
    setBearingLoads(prev=>{
      const arr=[...prev]
      while(arr.length<count) arr.push({id:arr.length+1,Fy:2000,Fx:60,Mz:0})
      return arr.slice(0,count)
    })
    updG({bearingCount:count})
  }

  const {nodes,members,pointLoads,copingW,bearingXs}=useMemo(
    ()=>buildModel(geom,bearingLoads),[geom,bearingLoads])

  const result=useMemo(()=>solveFrame(nodes,members,pointLoads),[nodes,members,pointLoads])

  const bv=(a:boolean):React.CSSProperties=>({
    border:'none',padding:'0.18rem 0.55rem',fontSize:'0.62rem',fontWeight:700,
    fontFamily:'var(--font-mono)',cursor:'pointer',borderRadius:'2px',
    background:a?'var(--primary)':'var(--surface-3)',color:a?'#fff':'var(--text-3)',
  })

  return (
    <div style={{display:'flex',flex:1,height:'100%',overflow:'hidden'}}>

      {/* ══ 좌: 입력 ══ */}
      <div style={{width:'clamp(215px,21%,270px)',flexShrink:0,display:'flex',flexDirection:'column',
        borderRight:'1px solid var(--border-dark)',background:'var(--surface)',overflow:'hidden'}}>

        <div style={{padding:'0.32rem 0.65rem',background:'var(--surface-3)',borderBottom:'1px solid var(--border-dark)',
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'0.68rem',fontWeight:700,color:'var(--text-3)',
            letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'var(--font-mono)'}}>Pier Model</span>
          <span style={{fontSize:'0.58rem',color:'var(--primary)',fontFamily:'var(--font-mono)',
            background:'var(--primary-bg)',border:'1px solid var(--primary-dim)',
            borderRadius:'2px',padding:'0.05rem 0.35rem',fontWeight:700}}>DSM · 2D</span>
        </div>

        <div style={{flex:1,overflowY:'auto'}}>
          <GH title="Pier Geometry" sub="교각 형상"/>
          <Row label="기둥 수">
            <div style={{display:'flex',gap:'2px',padding:'0.1rem 0'}}>
              {[1,2,3].map(n=>(
                <button key={n} onClick={()=>updG({colCount:n})} style={{
                  flex:1,border:'1px solid var(--border-dark)',padding:'0.15rem 0',
                  fontSize:'0.72rem',fontWeight:700,fontFamily:'var(--font-mono)',cursor:'pointer',
                  background:geom.colCount===n?'var(--primary)':'var(--surface-2)',
                  color:geom.colCount===n?'#fff':'var(--text-3)',borderRadius:'2px'}}>
                  {n}주
                </button>
              ))}
            </div>
          </Row>
          {geom.colCount>1&&(
            <Row label="기둥 순간격(m)">
              <Num value={geom.colSpacing} min={1} step={0.5} onChange={v=>updG({colSpacing:v})}/>
            </Row>
          )}
          <Row label="기둥 높이(m)"><Num value={geom.colHeight} min={1} step={0.5} onChange={v=>updG({colHeight:v})}/></Row>

          <GH title="Section" sub="단면 (m)"/>
          <Row label="기둥 폭(m)"><Num value={geom.colWidth} min={0.3} step={0.1} onChange={v=>updG({colWidth:v})}/></Row>
          <Row label="기둥 깊이(m)"><Num value={geom.colDepth} min={0.3} step={0.1} onChange={v=>updG({colDepth:v})}/></Row>
          <Row label="코핑 깊이(m)"><Num value={geom.copingDepth} min={0.5} step={0.1} onChange={v=>updG({copingDepth:v})}/></Row>

          <GH title="Material" sub="KDS 24 14 21"/>
          <Row label="fck (MPa)"><Num value={geom.fck} min={21} step={3} onChange={v=>updG({fck:v})}/></Row>
          <Row label="Ec (MPa)">
            <div style={{padding:'0.1rem 0.3rem',fontSize:'0.75rem',fontWeight:700,
              fontFamily:'var(--font-mono)',color:'var(--primary)'}}>
              {Math.round(Ec(geom.fck)).toLocaleString()}
            </div>
          </Row>

          {/* 단면 특성 요약 */}
          <div style={{padding:'0.22rem 0.5rem',background:'var(--surface-2)',
            borderTop:'1px solid var(--border-light)',fontSize:'0.62rem',
            fontFamily:'var(--font-mono)',color:'var(--text-3)',lineHeight:1.8}}>
            <div>A<sub>g</sub> = {(geom.colWidth*geom.colDepth*1e4).toFixed(0)} cm²</div>
            <div>I<sub>g</sub> = {(geom.colWidth*Math.pow(geom.colDepth,3)/12*1e8).toFixed(0)} cm⁴</div>
            <div>코핑 폭 = {copingW.toFixed(2)} m</div>
          </div>

          <GH title="Bearing Loads" sub="받침 하중"/>
          <Row label="받침 수">
            <div style={{display:'flex',gap:'2px',padding:'0.1rem 0'}}>
              {[1,2,3,4].map(n=>(
                <button key={n} onClick={()=>syncBearings(n)} style={{
                  flex:1,border:'1px solid var(--border-dark)',padding:'0.15rem 0',
                  fontSize:'0.72rem',fontWeight:700,fontFamily:'var(--font-mono)',cursor:'pointer',
                  background:geom.bearingCount===n?'var(--primary)':'var(--surface-2)',
                  color:geom.bearingCount===n?'#fff':'var(--text-3)',borderRadius:'2px'}}>
                  {n}
                </button>
              ))}
            </div>
          </Row>

          {bearingLoads.slice(0,geom.bearingCount).map((bl,bi)=>(
            <div key={bl.id}>
              <div style={{padding:'0.16rem 0.55rem',background:'var(--primary-bg)',
                borderBottom:'1px solid var(--primary-dim)',
                fontSize:'0.62rem',fontWeight:700,color:'var(--primary)',fontFamily:'var(--font-mono)'}}>
                BRG-{bi+1}  <span style={{color:'var(--text-disabled)',fontWeight:400,fontSize:'0.58rem'}}>x = {bearingXs[bi]?.toFixed(2)}m</span>
              </div>
              <Row label="Fy (kN)">
                <Num value={bl.Fy} step={100} onChange={v=>setBearingLoads(prev=>{const a=[...prev];a[bi]={...a[bi],Fy:v};return a})}/>
              </Row>
              <Row label="Fx (kN)">
                <Num value={bl.Fx} step={10} onChange={v=>setBearingLoads(prev=>{const a=[...prev];a[bi]={...a[bi],Fx:v};return a})}/>
              </Row>
              <Row label="Mz (kN·m)">
                <Num value={bl.Mz} step={10} onChange={v=>setBearingLoads(prev=>{const a=[...prev];a[bi]={...a[bi],Mz:v};return a})}/>
              </Row>
            </div>
          ))}
        </div>
      </div>

      {/* ══ 우: 뷰 영역 ══ */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--bg)'}}>

        {/* 툴바 */}
        <div style={{padding:'0.28rem 0.6rem',background:'var(--surface-2)',
          borderBottom:'1px solid var(--border-dark)',display:'flex',alignItems:'center',gap:'0.35rem',flexShrink:0}}>
          <span style={{fontSize:'0.6rem',color:'var(--text-3)',fontFamily:'var(--font-mono)',marginRight:'0.2rem'}}>VIEW</span>
          <button style={bv(activeView==='model')} onClick={()=>setActiveView('model')}>모델</button>
          <button style={bv(activeView==='result')} onClick={()=>setActiveView('result')}>결과표</button>
          <div style={{width:'1px',height:'1rem',background:'var(--border-dark)',margin:'0 0.15rem'}}/>
          <span style={{fontSize:'0.6rem',color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>표시</span>
          <button style={bv(showBMD)} onClick={()=>setShowBMD(v=>!v)}>BMD</button>
          <button style={bv(showDeformed)} onClick={()=>setShowDeformed(v=>!v)}>변형</button>
          <div style={{flex:1}}/>
          <span style={{fontSize:'0.6rem',color:'var(--text-disabled)',fontFamily:'var(--font-mono)'}}>
            {nodes.length}N · {members.length}M · {nodes.length*3}DOF
          </span>
        </div>

        {activeView==='model'&&(
          <div style={{flex:1,overflow:'hidden',padding:'0.5rem',display:'flex',flexDirection:'column',gap:'0.4rem'}}>
            <div style={{flex:1,minHeight:0}}>
              <ModelSVG
                nodes={nodes} members={members} result={result}
                colHeight={geom.colHeight} copingW={copingW} copingDepth={geom.copingDepth}
                geom={geom} bearingLoads={bearingLoads} bearingXs={bearingXs}
                showBMD={showBMD} showDeformed={showDeformed}/>
            </div>

            {/* Critical Forces 요약 */}
            <div style={{background:'var(--surface)',border:'1px solid var(--border-dark)',
              borderRadius:'3px',padding:'0.28rem 0.6rem',flexShrink:0}}>
              <div style={{fontSize:'0.6rem',fontWeight:700,color:'var(--text-3)',
                fontFamily:'var(--font-mono)',letterSpacing:'0.08em',marginBottom:'0.2rem'}}>
                CRITICAL FORCES
              </div>
              <div style={{display:'flex',gap:'1.2rem',flexWrap:'wrap'}}>
                {result.memberForces.map((mf,i)=>{
                  const mem=members.find(m=>m.id===mf.memberId)
                  const maxM=Math.max(Math.abs(mf.Mi),Math.abs(mf.Mj))
                  const maxV=Math.max(Math.abs(mf.Vi),Math.abs(mf.Vj))
                  const maxN=Math.max(Math.abs(mf.Ni),Math.abs(mf.Nj))
                  return (
                    <div key={mf.memberId} style={{display:'flex',gap:'0.5rem',alignItems:'baseline'}}>
                      <span style={{fontSize:'0.6rem',fontWeight:700,color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>
                        {mem?.type==='coping'?`COP-${i}`:`COL-${i+1}`}
                      </span>
                      <span style={{fontSize:'0.7rem',fontWeight:700,color:'var(--primary)',fontFamily:'var(--font-mono)'}}>
                        M={maxM.toFixed(0)}<span style={{fontSize:'0.57rem',color:'var(--text-disabled)'}}>kN·m</span>
                      </span>
                      <span style={{fontSize:'0.7rem',fontWeight:700,color:'var(--warning)',fontFamily:'var(--font-mono)'}}>
                        V={maxV.toFixed(0)}<span style={{fontSize:'0.57rem',color:'var(--text-disabled)'}}>kN</span>
                      </span>
                      <span style={{fontSize:'0.67rem',color:'var(--text-3)',fontFamily:'var(--font-mono)'}}>
                        N={maxN.toFixed(0)}<span style={{fontSize:'0.57rem',color:'var(--text-disabled)'}}>kN</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {activeView==='result'&&(
          <div style={{flex:1,overflow:'hidden'}}>
            <ResultSection result={result} members={members}/>
          </div>
        )}
      </div>
    </div>
  )
}
