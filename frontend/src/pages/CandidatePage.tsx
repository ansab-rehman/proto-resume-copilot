import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api'
import BaselineBadge from '../components/BaselineBadge'
import ScoreDonut from '../components/ScoreDonut'
import {
  DECISION_HINT,
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
      <nav className="crumbs">
        <Link to="/">Roles</Link>
        <span>/</span>
        <Link to={`/roles/${c.role_id}`}>{c.role_title}</Link>
      </nav>
      <div className="page-head">
        <div>
          <p className="eyebrow">Candidate</p>
          <h1>{ev?.candidate_name ?? c.candidate_name ?? c.filename}</h1>
          <p className="meta mono">{c.filename}</p>
        </div>
        <div className="row">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => confirm('Delete this candidate?') && del.mutate()}
          >
            Delete
          </button>
        </div>
      </div>

      <p className="ai-note">
        <strong>AI-assisted summary.</strong> It never recommends hiring or rejecting. Check the
        quoted evidence against the resume before you decide.
      </p>

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
          <h3>Baseline</h3>
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
          <h3 className="score-label" title={SCORE_TOOLTIP}>Rubric match</h3>
          <ScoreDonut score={s} />
          <p className="muted small">
            {SCORE_TOOLTIP} Met counts 1, partial ½, not found or unclear 0.
          </p>
          {failing && <p className="small warn">Baseline not met. Score shown for reference only.</p>}
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
  const [flash, setFlash] = useState<string | null>(null)
  const dirty = note !== c.note

  const save = useMutation({
    mutationFn: (patch: { decision?: Decision; note?: string }) => api.updateCandidate(c.id, patch),
    onSuccess: (_, patch) => {
      onSaved()
      setFlash(patch.note !== undefined ? 'Note saved' : 'Decision saved')
    },
  })

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])

  return (
    <section className="card decision-panel">
      <h2>Your decision</h2>
      <p className="muted small">
        Record where this candidate stands. Only you set this, never the AI. It shows in the
        role's candidate list so your team can see progress.
      </p>
      <div className="decision-options" role="radiogroup" aria-label="Decision">
        {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={c.decision === d}
            className={`decision-option opt-${d}${c.decision === d ? ' selected' : ''}`}
            onClick={() => c.decision !== d && save.mutate({ decision: d })}
            disabled={save.isPending}
          >
            <span className="radio-dot" aria-hidden />
            <span>
              <span className="opt-label">{DECISION_LABEL[d]}</span>
              <span className="opt-hint">{DECISION_HINT[d]}</span>
            </span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Note</span>
        <textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) save.mutate({ note })
          }}
          placeholder="e.g. Strong on React, ask about AWS depth in the interview."
        />
      </label>
      <div className="decision-foot">
        <button
          className="btn btn-primary btn-sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ note })}
        >
          Save note
        </button>
        <span className="small" aria-live="polite">
          {save.isError ? (
            <span className="error">{errorMessage(save.error)}</span>
          ) : save.isPending ? (
            <span className="muted">Saving…</span>
          ) : flash ? (
            <span className="ok">✓ {flash}</span>
          ) : dirty ? (
            <span className="warn">Unsaved changes</span>
          ) : null}
        </span>
      </div>
    </section>
  )
}
