export type ModuleId = 'model-compare' | 'deploy-agent'

export interface NavModule {
  id: ModuleId
  label: string
  icon: string   // emoji 或 lucide icon name
  description: string
  status: 'active' | 'coming-soon'
}
