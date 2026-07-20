import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Header } from '@/core/components/Header'
import { Sidebar } from '@/core/components/Sidebar'
import { useAppStore } from '@/stores/appStore'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'
import TaskitPage from '@/pages/TaskitPage'

function AppLayout() {
  const { activeModule, setActiveModule } = useAppStore()

  return (
    <div className="h-screen flex flex-col bg-muted/30">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />

        <main className="flex-1 p-8 overflow-y-auto">
          <TaskitPage />
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>} />
        <Route path="/tasks/:id" element={<AuthGuard><AppLayout /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
