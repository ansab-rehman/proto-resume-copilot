import type { Baseline, BaselineStatus, Decision, ReqStatus, Verdict } from '../types'

export const BASELINE_LABEL: Record<BaselineStatus, string> = {
  meets: 'Meets baseline',
  does_not_meet: 'Does not meet baseline',
  needs_review: 'Needs review',
}

// "Not found in resume", never "Not met": it's the model's claim of absence.
export const VERDICT_LABEL: Record<Verdict, string> = {
  met: 'Met',
  partial: 'Partial',
  not_met: 'Not found in resume',
  unclear: 'Unclear',
}

export const STATUS_LABEL: Record<ReqStatus, string> = {
  met: 'Met',
  needs_review: 'Needs review',
  failing: 'Not found in resume',
}

export const STATUS_ICON: Record<ReqStatus, string> = {
  met: '✓',
  needs_review: '?',
  failing: '✕',
}

export const DECISION_LABEL: Record<Decision, string> = {
  new: 'Not reviewed',
  advance: 'Advance',
  hold: 'On hold',
  reject: 'Reject',
}

export const DECISION_HINT: Record<Decision, string> = {
  new: "You haven't made a call yet",
  advance: 'Move to the next interview stage',
  hold: 'Promising, revisit later',
  reject: 'Not moving forward for this role',
}

export function baselineCounts(b: Baseline) {
  const parts = [`${b.met}/${b.total} must-haves met`]
  if (b.needs_review) parts.push(`${b.needs_review} needs review`)
  return parts.join(' · ')
}

export const SCORE_TOOLTIP = 'Coverage of your rubric, not a prediction of job success.'
