import { useQuery } from '@tanstack/react-query'
import { Link, Route, Routes } from 'react-router-dom'
import { api } from './api'
import CandidatePage from './pages/CandidatePage'
import RolePage from './pages/RolePage'
import RolesPage from './pages/RolesPage'

export default function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health })

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Resume Review Co-pilot
        </Link>
        <span className="topbar-note">AI-assisted. You make every decision.</span>
      </header>
      {health.data && !health.data.llm_configured && (
        <div className="banner banner-warn">
          <strong>LLM not configured.</strong> Set <code>LLM_API_KEY</code> in <code>.env</code> and
          restart the backend. You can browse existing data, but can't draft rubrics or evaluate.
        </div>
      )}
      {health.isError && (
        <div className="banner banner-error">Can't reach the backend. Is it running?</div>
      )}
      <main className="container">
        <Routes>
          <Route path="/" element={<RolesPage />} />
          <Route path="/roles/:roleId" element={<RolePage />} />
          <Route path="/candidates/:candidateId" element={<CandidatePage />} />
          <Route path="*" element={<p>Page not found. <Link to="/">Back to roles</Link></p>} />
        </Routes>
      </main>
    </div>
  )
}
