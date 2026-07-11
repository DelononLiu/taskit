import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import TaskitPage from '@/pages/TaskitPage'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><TaskitPage /></AuthGuard>} />
        <Route path="/tasks/:id" element={<AuthGuard><TaskitPage /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
