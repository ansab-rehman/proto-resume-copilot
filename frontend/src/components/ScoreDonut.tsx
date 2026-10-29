import type { Score } from '../types'

const R = 42
const C = 2 * Math.PI * R

type Segment = { value: number; className: string }

function Ring({ segments, size, stroke }: { segments: Segment[]; size: number; stroke: number }) {
  const lens = segments.map((s) => (Math.max(0, Math.min(100, s.value)) / 100) * C)
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="ring" aria-hidden>
      <circle cx="50" cy="50" r={R} className="ring-track" strokeWidth={stroke} />
      {segments.map((s, i) => (
        <circle
          key={i}
          cx="50"
          cy="50"
          r={R}
          className={s.className}
          strokeWidth={stroke}
          strokeDasharray={`${lens[i]} ${C - lens[i]}`}
          strokeDashoffset={-starts[i]}
          transform="rotate(-90 50 50)"
        />
      ))}
    </svg>
  )
}

/** Score as a donut: must-have points and nice-to-have points stacked out of 100. */
export default function ScoreDonut({ score }: { score: Score }) {
  const must = score.must_coverage * score.weights.must
  const nice = (score.nice_coverage ?? 0) * score.weights.nice
  return (
    <div className="donut">
      <div className="donut-chart">
        <Ring
          size={148}
          stroke={11}
          segments={[
            { value: must, className: 'ring-must' },
            { value: nice, className: 'ring-nice' },
          ]}
        />
        <div className="donut-center">
          <span className="donut-total">{score.total}</span>
          <span className="donut-of">of 100</span>
        </div>
      </div>
      <ul className="donut-legend">
        <li>
          <span className="swatch swatch-must" />
          <span>Must-haves</span>
          <span className="mono">
            {Math.round(must)}<span className="muted">/{score.weights.must}</span>
          </span>
        </li>
        <li>
          <span className="swatch swatch-nice" />
          <span>Nice-to-haves</span>
          <span className="mono">
            {score.nice_coverage === null ? (
              <span className="muted">none in rubric</span>
            ) : (
              <>
                {Math.round(nice)}<span className="muted">/{score.weights.nice}</span>
              </>
            )}
          </span>
        </li>
      </ul>
    </div>
  )
}

/** Compact single-arc ring for table rows. */
export function ScoreRing({ total }: { total: number }) {
  return (
    <span className="score-ring">
      <Ring size={26} stroke={14} segments={[{ value: total, className: 'ring-must' }]} />
      <span className="mono">{total}</span>
    </span>
  )
}
