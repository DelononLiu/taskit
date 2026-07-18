import { create } from 'zustand'
import type { ModuleId } from '@/core/types'
import type { DrawerMode } from '@/core/components/DetailDrawer'

interface AppState {
  activeModule: ModuleId
  drawerMode: DrawerMode
  drawerTaskId: number | null
  drawerTitle: string
  setActiveModule: (m: ModuleId) => void
  openDrawer: (mode: Exclude<DrawerMode, 'closed'>, taskId?: number, title?: string) => void
  closeDrawer: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'model-compare',
  drawerMode: 'closed',
  drawerTaskId: null,
  drawerTitle: '',
  setActiveModule: (m) => set({ activeModule: m, drawerMode: 'closed', drawerTaskId: null, drawerTitle: '' }),
  openDrawer: (mode, taskId, title) =>
    set({ drawerMode: mode, drawerTaskId: taskId ?? null, drawerTitle: title ?? '' }),
  closeDrawer: () => set({ drawerMode: 'closed', drawerTaskId: null, drawerTitle: '' }),
}))
