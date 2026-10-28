import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api'
import BaselineBadge from '../components/BaselineBadge'
import {
  DECISION_LABEL,
  SCORE_TOOLTIP,
  STATUS_ICON,
  STATUS_LABEL,
  VERDICT_LABEL,
  baselineCounts,
} from '../components/labels'
import type { CandidateDetail, Decision, Evaluation, VerdictRow } from '../types'

export default function CandidatePage() {
  const id = Number(useParams().candidateId)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const cand = useQuery({
    queryKey: ['candidate', id],
    queryFn: () => api.getCandidate(id),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['candidate', id] })
    if (cand.data) qc.invalidateQueries({ queryKey: ['candidates', cand.data.role_id] })
  }
  const reevaluate = useMutation({ mutationFn: () => api.reevaluate(id), onSettled: invalidate })
  const del = useMutation({
    mutationFn: () => api.deleteCandidate(id),
    onSuccess: () => {
      invalidate()
      navigate(`/roles/${cand.data?.role_id}`)
    },
  })

  if (cand.isPending) return <p className="muted">Loading…</p>
  if (cand.isError) return <p className="error">{errorMessage(cand.error)}</p>
  const c = cand.data
  const ev = c.evaluation

  return (
    <>
      <Link to={`/roles/${c.role_id}`} className="back">← {c.role_title}</Link>
      <div className="page-head">
        <div>
          <h1>{ev?.candidate_name ?? c.candidate_name ?? c.filename}</h1>
          <p className="muted small">{c.filename}</p>
        </div>
        <div className="row">
          <button
            className="btn btn-sm"
            disabled={c.status === 'processing' || reevaluate.isPending}
            onClick={() => reevaluate.mutate()}
          >
            Re-evaluate
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => confirm('Delete this candidate?') && del.mutate()}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="banner banner-info">
        <strong>AI-assisted summary. Verify before deciding.</strong> The AI doesn't recommend
        hiring or rejecting. Check the quoted evidence against the resume.
      </div>

      {reevaluate.isError && <p className="error">{errorMessage(reevaluate.error)}</p>}

      {c.stale && (
        <div className="banner banner-warn">
          Stale: the rubric changed since this evaluation (evaluated against v{c.rubric_version},
          current is v{c.role_rubric_version}).{' '}
          <button className="btn btn-sm" onClick={() => reevaluate.mutate()}>Re-evaluate</button>
        </div>
      )}
      {c.status === 'processing' && <div className="banner banner-info">Evaluating… this usually takes under a minute.</div>}
      {c.status === 'failed' && (
        <div className="banner banner-error">
          Evaluation failed: {c.error}{' '}
          <button className="btn btn-sm" onClick={() => reevaluate.mutate()}>Retry</button>
        </div>
      )}

      <div className="candidate-layout">
        <div className="candidate-main">
          {ev ? <EvaluationView ev={ev} /> : c.status !== 'processing' && <p className="muted">No evaluation yet.</p>}
          <details className="card">
            <summary>Extracted resume text</summary>
            <pre className="resume-text">{c.resume_text}</pre>
          </details>
        </div>
        <aside className="candidate-side">
          <DecisionPanel key={c.id} c={c} onSaved={invalidate} />
          {c.model_id && (
            <div className="card provenance small muted">
              <div>Model: {c.model_id}</div>
              <div>Prompt version: {c.prompt_version}</div>
              <div>Rubric version: v{c.rubric_version} (current v{c.role_rubric_version})</div>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}

function EvaluationView({ ev }: { ev: Evaluation }) {
  const musts = ev.verdicts.filter((v) => v.kind === 'must')
  const nices = ev.verdicts.filter((v) => v.kind === 'nice')
  const failing = ev.baseline.status === 'does_not_meet'
  const s = ev.score

  return (
    <>
      <section className="card overview">
        <div className="overview-baseline">
          <BaselineBadge status={ev.baseline.status} large />
          <p className="muted small">{baselineCounts(ev.baseline)}</p>
          <ul className="checklist">
            {musts.map((v) => (
              <li key={v.requirement_id} className={`check-${v.status}`}>
                <span className="check-icon" aria-hidden>{STATUS_ICON[v.status]}</span>
                <span>{v.requirement}</span>
                <span className="check-label">{STATUS_LABEL[v.status]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`overview-score${failing ? ' deemph' : ''}`}>
          <div className="score-label" title={SCORE_TOOLTIP}>
            Rubric match score <span className="info">ⓘ</span>
          </div>
          <div className="score-number">{s.total}</div>
          <p className="muted small">{SCORE_TOOLTIP}</p>
          <table className="breakdown small">
            <tbody>
              <tr>
                <td>Must-haves</td>
                <td>{Math.round(s.must_coverage * 100)}% × {s.weights.must}</td>
                <td>{Math.round(s.must_coverage * s.weights.must)}</td>
              </tr>
              <tr>
                <td>Nice-to-haves</td>
                <td>
                  {s.nice_coverage === null ? 'none in rubric' : `${Math.round(s.nice_coverage * 100)}% × ${s.weights.nice}`}
                </td>
                <td>{s.nice_coverage === null ? '—' : Math.round(s.nice_coverage * s.weights.nice)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">Met = 1, partial = ½, not found or unclear = 0.</p>
          {failing && <p className="small">Baseline not met. Score shown for reference only.</p>}
        </div>
      </section>

      <section className="card">
        <h2>Summary</h2>
        <p>{ev.summary}</p>
      </section>

      <section className="card">
        <h2>Baseline requirements</h2>
        <p className="muted small">A matching quote shows the text exists, not that the conclusion is right.</p>
        {musts.map((v) => <VerdictCard key={v.requirement_id} v={v} />)}
      </section>

      {nices.length > 0 && (
        <section className="card">
          <h2>Nice-to-haves</h2>
          {nices.map((v) => <VerdictCard key={v.requirement_id} v={v} />)}
        </section>
      )}

      {ev.highlights.length > 0 && (
        <section className="card">
          <h2>Noteworthy</h2>
          <ul className="highlights">
            {ev.highlights.map((h, i) => (
              <li key={i}>
                <strong>{h.title}</strong>
                {h.quote && <Quote text={h.quote} found={h.quote_found} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ev.interview_questions.length > 0 && (
        <section className="card">
          <h2>Gaps &amp; interview questions</h2>
          <ol>
            {ev.interview_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </section>
      )}
    </>
  )
}

function VerdictCard({ v }: { v: VerdictRow }) {
  return (
    <div className={`verdict verdict-${v.status}`}>
      <div className="verdict-head">
        <span className="verdict-req">{v.requirement}</span>
        <span className={`chip chip-${v.verdict}`}>{VERDICT_LABEL[v.verdict]}</span>
        {v.status === 'needs_review' && <span className="chip chip-review">Needs review</span>}
      </div>
      {v.quote ? (
        <Quote text={v.quote} found={v.quote_found} />
      ) : (
        <p className="muted small">No supporting quote.</p>
      )}
      <p className="small">{v.rationale}</p>
    </div>
  )
}

function Quote({ text, found }: { text: string; found: boolean }) {
  return (
    <figure className="quote">
      <blockquote>“{text}”</blockquote>
      <figcaption className={found ? 'ok small' : 'warn small'}>
        {found ? '✓ Quote found in resume' : '⚠ Quote not found in resume. Needs review.'}
      </figcaption>
    </figure>
  )
}

function DecisionPanel({ c, onSaved }: { c: CandidateDetail; onSaved: () => void }) {
  const [note, setNote] = useState(c.note)

  const save = useMutation({
    mutationFn: (patch: { decision?: Decision; note?: string }) => api.updateCandidate(c.id, patch),
    onSuccess: onSaved,
  })

  return (
    <div className="card decision-panel">
      <h2>Your decision</h2>
      <div className="segmented">
        {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
          <button
            key={d}
            className={c.decision === d ? `seg active decision-${d}` : 'seg'}
            onClick={() => save.mutate({ decision: d })}
            disabled={save.isPending}
          >
            {DECISION_LABEL[d]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Note</span>
        <textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== c.note && save.mutate({ note })}
          placeholder="Why advance, hold or reject?"
        />
      </label>
      {save.isError && <p className="error small">{errorMessage(save.error)}</p>}
      {save.isSuccess && !save.isPending && <p className="muted small">Saved</p>}
    </div>
  )
}
