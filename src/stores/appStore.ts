import { create } from 'zustand'
import type { ModuleId } from '@/core/types'

interface AppState {
  activeModule: ModuleId
  setActiveModule: (m: ModuleId) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'model-compare',
  setActiveModule: (m) => set({ activeModule: m }),
}))
