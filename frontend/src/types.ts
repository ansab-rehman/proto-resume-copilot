export type Kind = 'must' | 'nice'
export type Verdict = 'met' | 'partial' | 'not_met' | 'unclear'
export type ReqStatus = 'met' | 'needs_review' | 'failing'
export type BaselineStatus = 'meets' | 'does_not_meet' | 'needs_review'
export type Decision = 'new' | 'advance' | 'hold' | 'reject'
export type CandidateStatus = 'processing' | 'done' | 'failed'

export interface Requirement {
  id: string
  text: string
  kind: Kind
}

export interface Role {
  id: number
  title: string
  jd_markdown: string
  rubric: { requirements: Requirement[] }
  rubric_version: number
  created_at: string
  rubric_error?: string | null
}

export interface RoleListItem {
  id: number
  title: string
  created_at: string
  candidate_count: number
  requirement_count: number
}

export interface Baseline {
  status: BaselineStatus
  met: number
  total: number
  needs_review: number
  failing: number
}

export interface Score {
  total: number
  must_coverage: number
  nice_coverage: number | null
  weights: { must: number; nice: number }
}

export interface CandidateSummary {
  id: number
  role_id: number
  filename: string
  status: CandidateStatus
  error: string | null
  decision: Decision
  note: string
  created_at: string
  stale: boolean
  candidate_name: string | null
  baseline: Baseline | null
  score: Score | null
  top_highlight: string | null
}

export interface VerdictRow {
  requirement_id: string
  requirement: string
  kind: Kind
  verdict: Verdict
  quote: string | null
  quote_found: boolean
  rationale: string
  status: ReqStatus
}

export interface Evaluation {
  candidate_name: string | null
  summary: string
  verdicts: VerdictRow[]
  highlights: { title: string; quote: string | null; quote_found: boolean }[]
  interview_questions: string[]
  baseline: Baseline
  score: Score
}

export interface CandidateDetail extends CandidateSummary {
  role_title: string
  role_rubric_version: number
  evaluation: Evaluation | null
  resume_text: string
  model_id: string | null
  prompt_version: string | null
  rubric_version: number | null
}

export interface Health {
  llm_configured: boolean
  model_id: string
}
