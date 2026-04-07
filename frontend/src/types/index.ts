// ─── 설계기준 ─────────────────────────────────────────────
export type DesignCode = 'KDS'

// ─── 검토 모듈 종류 ────────────────────────────────────────
export type ModuleId =
  | 'simple-beam'
  | 'deep-beam'
  | 'rc-column'
  | 'rc-wall'
  | 'pier-frame'

export interface ModuleInfo {
  id: ModuleId
  label: string
  labelEn: string
  group: string
  standard: string   // 적용 기준번호
  icon: string       // lucide icon name
}

// ─── 재료 ─────────────────────────────────────────────────
export interface MaterialInput {
  fck: number        // 콘크리트 설계기준압축강도 (MPa)
  fy: number         // 철근 항복강도 (MPa)
  Es: number         // 철근 탄성계수 (MPa), default 200000
}

// ─── 단면 ─────────────────────────────────────────────────
export type CoverMode = 'stirrup' | 'center'
// stirrup: 피복 = 콘크리트 외면 ~ 스터럽 외면 (표준 입력)
// center : 피복 = 콘크리트 외면 ~ 인장철근 중심 (d' 직접 입력)

export interface SectionInput {
  b: number          // 폭 (mm)
  h: number          // 전체 높이 (mm)
  d: number          // 유효 깊이 (mm)  — 자동계산
  cover: number      // 피복 두께 (mm)
  coverMode?: CoverMode  // 피복 입력 방식 (기본: 'stirrup')
}

// ─── 철근 ─────────────────────────────────────────────────
export type RebarInputMode = 'count' | 'spacing'

export interface RebarLayer {
  count: number           // 철근 개수 (개수모드: 직접입력, 간격모드: 자동계산)
  dia: number             // 철근 직경 (mm): 10,13,16,19,22,25,29,32,35
  row: number             // 배치 행 (1: 1단, 2: 2단)
  inputMode?: RebarInputMode  // 입력 방식 (기본값: 'count')
  spacing?: number        // 간격모드일 때 배근 간격 (mm)
}

export interface ReinforcementInput {
  tension: RebarLayer[]       // 인장 철근
  compression: RebarLayer[]   // 압축 철근 (복근보)
  stirrup_dia: number         // 스터럽 직경 (mm)
  stirrup_spacing: number     // 스터럽 간격 (mm)
  stirrup_legs: number        // 스터럽 다리수 (2, 3, 4 ...)
}

// ─── 하중 ─────────────────────────────────────────────────
export interface LoadInput {
  Mu: number         // 계수 휨모멘트 (kN·m)
  Vu: number         // 계수 전단력 (kN)
  Nu: number         // 계수 축력 (kN), 압축 +
  span: number       // 경간 (mm)
  wD: number         // 고정하중 (kN/m)
  wL: number         // 활하중 (kN/m)
}

// ─── 검토 결과 ────────────────────────────────────────────
export type CheckStatus = 'OK' | 'NG' | 'WARN'

// 계산과정 한 줄의 타입
export type CalcLineType =
  | 'section'    // 소제목 (회색 배경, 굵게)
  | 'eq'         // 일반 계산식
  | 'eq-key'     // 중요 계산식 (볼드 + 붉은 밑줄)
  | 'result'     // 최종 결과값 강조
  | 'verdict'    // 판정 줄 (OK/NG 색상)
  | 'note'       // 참고사항 (이탤릭, 회색)

export interface CalcLine {
  type: CalcLineType
  text: string           // 좌측 수식/설명
  value?: string         // 우측 결과값 (있을 경우)
  indent?: number        // 들여쓰기 단계 (0=기본, 1=1단, 2=2단)
}

export interface CheckItem {
  id: string
  label: string
  demandSymbol: string
  capacitySymbol: string
  demand: number
  capacity: number
  unit: string
  SF: number
  ratio: number
  status: CheckStatus
  formula: string        // 요약 검토식 (헤더 아래 항상 표시)
  detail: Record<string, string>  // 하위 호환용 (미사용)
  steps: CalcLine[]      // 순차 계산과정 (노트필기 스타일)
}

export interface CheckResult {
  moduleId: ModuleId
  items: CheckItem[]
  overallStatus: CheckStatus
  maxRatio: number
  warnings: string[]
}

// ─── 앱 전역 상태 ─────────────────────────────────────────
export interface AppState {
  activeModule: ModuleId
  designCode: DesignCode
  material: MaterialInput
  section: SectionInput
  reinforcement: ReinforcementInput
  load: LoadInput
  result: CheckResult | null
}
