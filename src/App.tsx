import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Header } from '@/core/components/Header'
import { Sidebar } from '@/core/components/Sidebar'
import { DetailDrawer } from '@/core/components/DetailDrawer'
import { useAppStore } from '@/stores/appStore'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'
import TaskitPage from '@/pages/TaskitPage'
import { DrawerTaskForm } from '@/tasks/model_compare/DrawerTaskForm'
import { DrawerTaskDetail } from '@/tasks/model_compare/DrawerTaskDetail'

function AppLayout() {
  const { activeModule, setActiveModule, drawerMode, drawerTaskId, drawerTitle, openDrawer, closeDrawer } = useAppStore()
  const navigate = useNavigate()

  const handleCloseDrawer = () => {
    closeDrawer()
    navigate('/', { replace: true })
  }

  const handleNewTask = () => {
    openDrawer('new-task', undefined, '新建精度比对任务')
  }

  return (
    <div className="h-screen flex flex-col bg-[#f4f9fd]">
      <Header onNewTask={handleNewTask} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />

        <main className="flex-1 p-8 overflow-y-auto">
          <TaskitPage />
        </main>
      </div>

      <DetailDrawer
        open={drawerMode !== 'closed'}
        mode={drawerMode}
        title={drawerTitle}
        onClose={handleCloseDrawer}
      >
        {drawerMode === 'new-task' && (
          <DrawerTaskForm onSuccess={() => { closeDrawer() }} />
        )}
        {drawerMode === 'task-detail' && drawerTaskId != null && (
          <DrawerTaskDetail taskId={drawerTaskId} />
        )}
      </DetailDrawer>
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
