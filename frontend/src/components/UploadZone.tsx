import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { api, errorMessage } from '../api'

type Upload = { id: number; name: string; state: 'uploading' | 'error'; error?: string }

let nextId = 0

export default function UploadZone({ roleId, disabled }: { roleId: number; disabled?: boolean }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>([])

  // One request per file, in parallel, so each file gets its own error.
  const send = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = nextId++
      setUploads((u) => [...u, { id, name: file.name, state: 'uploading' }])
      api
        .uploadCandidate(roleId, file)
        .then(() => {
          setUploads((u) => u.filter((x) => x.id !== id))
          qc.invalidateQueries({ queryKey: ['candidates', roleId] })
        })
        .catch((e) =>
          setUploads((u) =>
            u.map((x) => (x.id === id ? { ...x, state: 'error', error: errorMessage(e) } : x)),
          ),
        )
    }
  }

  return (
    <div>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) send(e.dataTransfer.files)
        }}
        onClick={() => !disabled && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && input.current?.click()}
      >
        <span><strong>Drop resumes here</strong> or click to choose</span>
        <span className="muted small">PDF or .docx · text-based (no scans) · up to 5 MB each</span>
        <input
          ref={input}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) send(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {uploads.length > 0 && (
        <ul className="upload-list">
          {uploads.map((u) => (
            <li key={u.id} className={u.state === 'error' ? 'error' : 'muted'}>
              <span>{u.name}</span>
              {u.state === 'uploading' ? (
                <span>Uploading…</span>
              ) : (
                <>
                  <span>{u.error}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}
                  >
                    Dismiss
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
