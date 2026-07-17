import { create } from 'zustand'
import type { ComparisonTask, LayerDiff, TaskStatus } from '@/types'
import { createTask as apiCreateTask, getTask, getTaskLayers, getTaskHistory } from '@/api'

interface TaskState {
  currentTaskId: number | null
  task: ComparisonTask | null
  status: TaskStatus
  progress: number
  layers: LayerDiff[]
  selectedLayer: string | null
  selectedFramework: string

  // 新增：任务列表
  tasks: ComparisonTask[]
  tasksLoading: boolean

  createTask: (modelId: string, frameworks: string[]) => Promise<number>
  pollTask: (taskId: number) => Promise<void>
  loadLayers: (taskId: number, framework?: string) => Promise<void>
  setSelectedLayer: (layerName: string | null) => void
  setSelectedFramework: (framework: string) => void
  reset: () => void
  // 新增
  fetchTasks: () => Promise<void>
  fetchTask: (id: number) => Promise<ComparisonTask | null>
}

export const useTaskStore = create<TaskState>((set, get) => ({
  currentTaskId: null,
  task: null,
  status: 'pending',
  progress: 0,
  layers: [],
  selectedLayer: null,
  selectedFramework: 'tensorrt',

  // 新增
  tasks: [],
  tasksLoading: false,

  fetchTasks: async () => {
    set({ tasksLoading: true })
    try {
      const items = await getTaskHistory()
      set({ tasks: items as ComparisonTask[], tasksLoading: false })
    } catch {
      set({ tasks: [], tasksLoading: false })
    }
  },

  fetchTask: async (id) => {
    try {
      const task = await getTask(id)
      return task as ComparisonTask
    } catch {
      return null
    }
  },

  createTask: async (modelId, frameworks) => {
    const task = await apiCreateTask({ modelId, frameworks })
    set({ currentTaskId: task.id, task, status: task.status, progress: task.progress })
    return task.id
  },

  pollTask: async (taskId) => {
    const task = await getTask(taskId)
    set({ task, status: task.status, progress: task.progress })
    if (task.status === 'completed' || task.status === 'failed') {
      return
    }
    // Auto-poll every 2s while running
    setTimeout(() => get().pollTask(taskId), 2000)
  },

  loadLayers: async (taskId, framework) => {
    const fw = framework || get().selectedFramework
    const { layers } = await getTaskLayers(taskId, fw)
    set({ layers })
  },

  setSelectedLayer: (layerName) => set({ selectedLayer: layerName }),
  setSelectedFramework: (framework) => set({ selectedFramework: framework }),
  reset: () => set({
    currentTaskId: null,
    task: null,
    status: 'pending',
    progress: 0,
    layers: [],
    selectedLayer: null,
    selectedFramework: 'tensorrt',
  }),
}))
