import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import Markdown from 'react-markdown'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api'
import RubricEditor from '../components/RubricEditor'
import UploadZone from '../components/UploadZone'
import BaselineBadge from '../components/BaselineBadge'
import { ScoreRing } from '../components/ScoreDonut'
import {
  DECISION_LABEL,
  SCORE_TOOLTIP,
  baselineCounts,
} from '../components/labels'
import type { CandidateSummary, Decision } from '../types'

type Sort = 'score' | 'uploaded'
type BulkOp = { decision: Decision } | 'delete'

export default function RolePage() {
  const roleId = Number(useParams().roleId)
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const rubricError = (location.state as { rubricError?: string } | null)?.rubricError
  const [showJd, setShowJd] = useState(false)
  const [sort, setSort] = useState<Sort>('score')
  const [meetsOnly, setMeetsOnly] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const role = useQuery({ queryKey: ['role', roleId], queryFn: () => api.getRole(roleId) })
  const candidates = useQuery({
    queryKey: ['candidates', roleId],
    queryFn: () => api.listCandidates(roleId),
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'processing') ? 2000 : false),
  })

  const reevaluate = useMutation({
    mutationFn: api.reevaluate,
    onSettled: () => qc.invalidateQueries({ queryKey: ['candidates', roleId] }),
  })
  const delCandidate = useMutation({
    mutationFn: api.deleteCandidate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['candidates', roleId] }),
  })
  // Bulk actions reuse the per-candidate endpoints; any failures are counted and reported.
  const bulk = useMutation({
    mutationFn: async ({ op, ids }: { op: BulkOp; ids: number[] }) => {
      const results = await Promise.allSettled(
        ids.map((id) => (op === 'delete' ? api.deleteCandidate(id) : api.updateCandidate(id, op))),
      )
      const failed = results.filter((x) => x.status === 'rejected').length
      if (failed) throw new Error(`${failed} of ${ids.length} candidates couldn't be updated.`)
    },
    onSuccess: () => setSelected(new Set()),
    onSettled: () => qc.invalidateQueries({ queryKey: ['candidates', roleId] }),
  })
  const delRole = useMutation({
    mutationFn: () => api.deleteRole(roleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      navigate('/')
    },
  })

  if (role.isPending) return <p className="muted">Loading…</p>
  if (role.isError) return <p className="error">{errorMessage(role.error)}</p>

  const r = role.data
  const hasMust = r.rubric.requirements.some((q) => q.kind === 'must')
  const rows = sortRows(
    (candidates.data ?? []).filter((c) => !meetsOnly || c.baseline?.status === 'meets'),
    sort,
  )
  const stale = (candidates.data ?? []).filter((c) => c.stale)
  // Only visible rows count, so filters and deletions never leave hidden selections behind.
  const selectedIds = rows.filter((c) => selected.has(c.id)).map((c) => c.id)
  const allSelected = rows.length > 0 && selectedIds.length === rows.length
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <>
      <nav className="crumbs">
        <Link to="/">Roles</Link>
        <span>/</span>
        <span>{r.title}</span>
      </nav>
      <div className="page-head">
        <div>
          <p className="eyebrow">Role</p>
          <h1>{r.title}</h1>
          <p className="meta mono">
            {r.rubric.requirements.length} requirements · {candidates.data?.length ?? 0} candidates
          </p>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowJd((v) => !v)}>
            {showJd ? 'Hide JD' : 'View JD'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => confirm(`Delete "${r.title}" and all its candidates?`) && delRole.mutate()}
          >
            Delete role
          </button>
        </div>
      </div>

      {showJd && (
        <div className="card markdown">
          <Markdown>{r.jd_markdown}</Markdown>
        </div>
      )}

      {rubricError && r.rubric.requirements.length === 0 && (
        <div className="banner banner-warn">
          Couldn't draft a rubric automatically: {rubricError} Add requirements below, or use
          "Redraft from JD" later.
        </div>
      )}

      <RubricEditor key={r.rubric_version} role={r} />

      <section className="card">
        <div className="section-head">
          <h2>Candidates</h2>
          {(candidates.data?.length ?? 0) > 0 && (
            <div className="toolbar">
              <label>
                Sort{' '}
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="score">Rubric match</option>
                  <option value="uploaded">Upload order</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={meetsOnly} onChange={(e) => setMeetsOnly(e.target.checked)} />
                Meets baseline only
              </label>
            </div>
          )}
        </div>
        {!hasMust ? (
          <p className="muted">Save a rubric with at least one must-have to start uploading resumes.</p>
        ) : (
          <UploadZone roleId={roleId} />
        )}

        {stale.length > 0 && (
          <div className="banner banner-warn">
            The rubric changed after {stale.length} evaluation{stale.length > 1 ? 's' : ''}.{' '}
            <button
              className="btn btn-sm"
              onClick={() => stale.forEach((c) => reevaluate.mutate(c.id))}
            >
              Re-evaluate {stale.length} stale
            </button>
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="bulk-bar">
            <strong>{selectedIds.length} selected</strong>
            <span className="muted small">Move to</span>
            {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
              <button
                key={d}
                className="btn btn-sm"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate({ op: { decision: d }, ids: selectedIds })}
              >
                {DECISION_LABEL[d]}
              </button>
            ))}
            <span className="bulk-spacer" />
            <button
              className="btn btn-sm btn-danger"
              disabled={bulk.isPending}
              onClick={() =>
                confirm(`Delete ${selectedIds.length} candidate${selectedIds.length > 1 ? 's' : ''}?`) &&
                bulk.mutate({ op: 'delete', ids: selectedIds })
              }
            >
              Delete
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
        {bulk.isError && <p className="error">{errorMessage(bulk.error)}</p>}

        {candidates.isError && <p className="error">{errorMessage(candidates.error)}</p>}
        {candidates.data?.length === 0 && hasMust && (
          <p className="muted">No candidates yet. Upload resumes above.</p>
        )}

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="candidates">
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all candidates"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.length > 0 && !allSelected
                      }}
                      onChange={() => setSelected(new Set(allSelected ? [] : rows.map((c) => c.id)))}
                    />
                  </th>
                  <th>Candidate</th>
                  <th>Baseline</th>
                  <th title={SCORE_TOOLTIP}>Rubric match ⓘ</th>
                  <th>Noteworthy</th>
                  <th>Decision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <CandidateRow
                    key={c.id}
                    c={c}
                    selected={selected.has(c.id)}
                    onToggle={() => toggle(c.id)}
                    onOpen={() => navigate(`/candidates/${c.id}`)}
                    onRetry={() => reevaluate.mutate(c.id)}
                    onDelete={() => confirm(`Delete ${c.candidate_name ?? c.filename}?`) && delCandidate.mutate(c.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {meetsOnly && rows.length === 0 && (candidates.data?.length ?? 0) > 0 && (
          <p className="muted">No candidates fully meet the baseline yet.</p>
        )}
        {reevaluate.isError && <p className="error">{errorMessage(reevaluate.error)}</p>}
      </section>
    </>
  )
}

function sortRows(rows: CandidateSummary[], sort: Sort) {
  if (sort === 'uploaded') return rows
  return [...rows].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))
}

function CandidateRow({
  c,
  selected,
  onToggle,
  onOpen,
  onRetry,
  onDelete,
}: {
  c: CandidateSummary
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  const failingBaseline = c.baseline?.status === 'does_not_meet'
  return (
    <tr className={selected ? 'clickable selected' : 'clickable'} onClick={onOpen}>
      <td className="select-cell" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${c.candidate_name ?? c.filename}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td>
        <div className="cand-name">{c.candidate_name ?? c.filename}</div>
        {c.candidate_name && <div className="muted small">{c.filename}</div>}
      </td>
      <td>
        {c.status === 'processing' && <span className="pill pill-processing">Evaluating…</span>}
        {c.status === 'failed' && (
          <div onClick={(e) => e.stopPropagation()}>
            <span className="pill pill-failed">Failed</span>
            <div className="error small">{c.error}</div>
            <button className="btn btn-sm" onClick={onRetry}>Retry</button>
          </div>
        )}
        {c.status === 'done' && c.baseline && (
          <>
            <BaselineBadge status={c.baseline.status} />
            <div className="muted small">{baselineCounts(c.baseline)}</div>
            {c.stale && <span className="pill pill-stale">Stale: rubric changed</span>}
          </>
        )}
      </td>
      <td className={failingBaseline ? 'score deemph' : 'score'}>
        {c.score ? <ScoreRing total={c.score.total} /> : <span className="muted">—</span>}
      </td>
      <td className="small">{c.top_highlight ?? <span className="muted">—</span>}</td>
      <td>
        <span className={`pill decision-${c.decision}`}>{DECISION_LABEL[c.decision]}</span>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={onDelete} aria-label="Delete candidate">
          ✕
        </button>
      </td>
    </tr>
  )
}
