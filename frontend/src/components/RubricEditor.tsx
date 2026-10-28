import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage } from '../api'
import type { Kind, Role } from '../types'

type Draft = { key: number; text: string; kind: Kind }

let nextKey = 0
const toDraft = (role: Role): Draft[] =>
  role.rubric.requirements.map((r) => ({ key: nextKey++, text: r.text, kind: r.kind }))

export default function RubricEditor({ role }: { role: Role }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(role))
  const [editing, setEditing] = useState(role.rubric.requirements.length === 0)

  const save = useMutation({
    mutationFn: () =>
      api.saveRubric(
        role.id,
        draft.filter((d) => d.text.trim()).map(({ text, kind }) => ({ text: text.trim(), kind })),
      ),
    onSuccess: (updated) => {
      qc.setQueryData(['role', role.id], updated)
      qc.invalidateQueries({ queryKey: ['candidates', role.id] })
      qc.invalidateQueries({ queryKey: ['roles'] })
      setDraft(toDraft(updated))
      setEditing(false)
    },
  })

  const regenerate = useMutation({
    mutationFn: () => api.regenerateRubric(role.id),
    onSuccess: (updated) => {
      qc.setQueryData(['role', role.id], updated)
      qc.invalidateQueries({ queryKey: ['candidates', role.id] })
      setDraft(toDraft(updated))
    },
  })

  const update = (key: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const remove = (key: number) => setDraft((d) => d.filter((x) => x.key !== key))
  const add = (kind: Kind) => setDraft((d) => [...d, { key: nextKey++, text: '', kind }])

  const hasMust = draft.some((d) => d.kind === 'must' && d.text.trim())
  const reqs = role.rubric.requirements

  if (!editing) {
    return (
      <section className="card">
        <div className="section-head">
          <h2>Rubric <span className="muted small">v{role.rubric_version}</span></h2>
          <div className="row">
            <button
              className="btn btn-ghost btn-sm"
              disabled={regenerate.isPending}
              onClick={() => {
                if (confirm('Replace the current rubric with a fresh draft from the JD?'))
                  regenerate.mutate()
              }}
            >
              {regenerate.isPending ? 'Drafting…' : 'Redraft from JD'}
            </button>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit rubric
            </button>
          </div>
        </div>
        {regenerate.isError && <p className="error">{errorMessage(regenerate.error)}</p>}
        <p className="muted small">Every candidate for this role is evaluated against these requirements.</p>
        {(['must', 'nice'] as const).map((kind) => (
          <div key={kind} className="rubric-group">
            <h3>{kind === 'must' ? 'Must-haves (baseline)' : 'Nice-to-haves'}</h3>
            <ul className="rubric-list">
              {reqs.filter((r) => r.kind === kind).map((r) => (
                <li key={r.id}>{r.text}</li>
              ))}
              {!reqs.some((r) => r.kind === kind) && <li className="muted">None</li>}
            </ul>
          </div>
        ))}
      </section>
    )
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Edit rubric</h2>
      </div>
      {(['must', 'nice'] as const).map((kind) => (
        <div key={kind} className="rubric-group">
          <h3>{kind === 'must' ? 'Must-haves (baseline)' : 'Nice-to-haves'}</h3>
          {draft
            .filter((d) => d.kind === kind)
            .map((d) => (
              <div key={d.key} className="rubric-row">
                <input
                  value={d.text}
                  onChange={(e) => update(d.key, { text: e.target.value })}
                  placeholder="e.g. 5+ years of professional Python"
                  maxLength={300}
                  aria-label="Requirement"
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => update(d.key, { kind: kind === 'must' ? 'nice' : 'must' })}
                  title={kind === 'must' ? 'Move to nice-to-haves' : 'Move to must-haves'}
                >
                  {kind === 'must' ? '→ Nice' : '→ Must'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => remove(d.key)}
                  aria-label="Remove requirement"
                >
                  ✕
                </button>
              </div>
            ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(kind)}>
            + Add {kind === 'must' ? 'must-have' : 'nice-to-have'}
          </button>
        </div>
      ))}
      {!hasMust && <p className="error">Add at least one must-have requirement.</p>}
      {save.isError && <p className="error">{errorMessage(save.error)}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={!hasMust || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save rubric'}
        </button>
        {reqs.length > 0 && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDraft(toDraft(role))
              setEditing(false)
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  )
}
