import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Header } from '@/core/components/Header'
import { Sidebar } from '@/core/components/Sidebar'
import { DetailDrawer } from '@/core/components/DetailDrawer'
import { useAppStore } from '@/stores/appStore'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'
import TaskitPage from '@/pages/TaskitPage'

function AppLayout() {
  const { activeModule, setActiveModule, drawerMode, drawerTitle, openDrawer, closeDrawer } = useAppStore()

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
        onClose={closeDrawer}
      >
        {drawerMode === 'new-task' && <div>新建任务表单（Task 8）</div>}
        {drawerMode === 'task-detail' && <div>任务详情面板（Task 9）</div>}
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
