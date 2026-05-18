import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { PageTransition } from './components/PageTransition'
import { DashboardPage } from './pages/DashboardPage'
import { SchedulerPage } from './pages/SchedulerPage'
import { AuthWrapper } from './components/AuthWrapper'

export default function App() {
  const location = useLocation()
  return (
    <AuthWrapper>
      <AppShell>
        <PageTransition locationKey={location.pathname}>
          <Routes location={location}>
            <Route path="/"          element={<DashboardPage />} />
            <Route path="/scheduler" element={<SchedulerPage />} />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
        </PageTransition>
      </AppShell>
    </AuthWrapper>
  )
}
