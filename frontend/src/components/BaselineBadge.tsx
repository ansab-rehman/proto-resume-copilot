import type { BaselineStatus } from '../types'
import { BASELINE_LABEL } from './labels'

export default function BaselineBadge({ status, large }: { status: BaselineStatus; large?: boolean }) {
  return (
    <span className={`badge badge-${status}${large ? ' badge-lg' : ''}`}>
      {BASELINE_LABEL[status]}
    </span>
  )
}
