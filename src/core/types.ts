export type ModuleId = 'model-diff' | 'deploy-agent'

export interface NavModule {
  id: ModuleId
  label: string
  icon: string   // emoji 或 lucide icon name
  description: string
  status: 'active' | 'coming-soon'
}
