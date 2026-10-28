import type {
  CandidateDetail,
  CandidateSummary,
  Decision,
  Health,
  Kind,
  Role,
  RoleListItem,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isJson = typeof init.body === 'string'
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail))
        message = body.detail.map((d: { msg: string }) => d.msg).join('; ')
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

export const api = {
  health: () => req<Health>('/health'),

  listRoles: () => req<RoleListItem[]>('/roles'),
  getRole: (id: number) => req<Role>(`/roles/${id}`),
  createRole: (title: string, jd_markdown: string) =>
    req<Role>('/roles', json('POST', { title, jd_markdown })),
  saveRubric: (id: number, requirements: { text: string; kind: Kind }[]) =>
    req<Role>(`/roles/${id}/rubric`, json('PUT', { requirements })),
  regenerateRubric: (id: number) => req<Role>(`/roles/${id}/rubric/extract`, { method: 'POST' }),
  deleteRole: (id: number) => req<void>(`/roles/${id}`, { method: 'DELETE' }),

  listCandidates: (roleId: number) => req<CandidateSummary[]>(`/roles/${roleId}/candidates`),
  uploadCandidate: (roleId: number, file: File) => {
    const body = new FormData()
    body.append('file', file)
    return req<CandidateSummary>(`/roles/${roleId}/candidates`, { method: 'POST', body })
  },
  getCandidate: (id: number) => req<CandidateDetail>(`/candidates/${id}`),
  updateCandidate: (id: number, patch: { decision?: Decision; note?: string }) =>
    req<CandidateSummary>(`/candidates/${id}`, json('PATCH', patch)),
  reevaluate: (id: number) =>
    req<CandidateSummary>(`/candidates/${id}/reevaluate`, { method: 'POST' }),
  deleteCandidate: (id: number) => req<void>(`/candidates/${id}`, { method: 'DELETE' }),
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
