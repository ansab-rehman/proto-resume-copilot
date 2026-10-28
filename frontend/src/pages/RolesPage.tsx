import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import Markdown from 'react-markdown'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../api'

export default function RolesPage() {
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.listRoles })
  const [creating, setCreating] = useState(false)

  const del = useMutation({
    mutationFn: api.deleteRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })

  return (
    <>
      <div className="page-head">
        <h1>Roles</h1>
        {!creating && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New role
          </button>
        )}
      </div>

      {creating && <NewRoleForm onCancel={() => setCreating(false)} />}

      {roles.isPending && <p className="muted">Loading…</p>}
      {roles.isError && <p className="error">{errorMessage(roles.error)}</p>}
      {roles.data?.length === 0 && !creating && (
        <div className="empty">
          <p>No roles yet.</p>
          <p className="muted">
            Create a role from a job description. You'll review the drafted rubric before any
            resume is evaluated.
          </p>
        </div>
      )}

      <ul className="role-list">
        {roles.data?.map((r) => (
          <li key={r.id} className="card role-card">
            <Link to={`/roles/${r.id}`} className="role-link">
              <span className="role-title">{r.title}</span>
              <span className="muted">
                {r.requirement_count} requirements · {r.candidate_count} candidates
              </span>
            </Link>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (confirm(`Delete "${r.title}" and all ${r.candidate_count} candidates?`))
                  del.mutate(r.id)
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function NewRoleForm({ onCancel }: { onCancel: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [jd, setJd] = useState('')
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  const create = useMutation({
    mutationFn: () => api.createRole(title, jd),
    onSuccess: (role) => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.setQueryData(['role', role.id], role)
      navigate(`/roles/${role.id}`, { state: { rubricError: role.rubric_error, fresh: true } })
    },
  })

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <label className="field">
        <span>Role title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Senior Full-Stack Engineer"
          required
          maxLength={200}
        />
      </label>
      <div className="field">
        <div className="tabs">
          <span>Job description (Markdown)</span>
          <button type="button" className={tab === 'write' ? 'tab active' : 'tab'} onClick={() => setTab('write')}>
            Write
          </button>
          <button type="button" className={tab === 'preview' ? 'tab active' : 'tab'} onClick={() => setTab('preview')}>
            Preview
          </button>
        </div>
        {tab === 'write' ? (
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={14}
            placeholder={'## Requirements\n- 5+ years of Python\n\n## Nice to have\n- AWS'}
            required
          />
        ) : (
          <div className="markdown preview">{jd ? <Markdown>{jd}</Markdown> : <p className="muted">Nothing to preview.</p>}</div>
        )}
      </div>
      {create.isError && <p className="error">{errorMessage(create.error)}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={create.isPending || !title.trim() || !jd.trim()}>
          {create.isPending ? 'Drafting rubric from JD…' : 'Create role & draft rubric'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </button>
      </div>
      <p className="muted small">
        The AI drafts must-have and nice-to-have requirements from the JD. You'll review and edit
        them before evaluating anyone.
      </p>
    </form>
  )
}
