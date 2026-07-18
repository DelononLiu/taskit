import { useEffect, useState } from 'react'
import type { ModuleId, NavModule } from '@/core/types'

const MODULES: NavModule[] = [
  {
    id: 'model-compare',
    label: '精度比对',
    icon: '📊',
    description: '神经网络模型精度差异对比分析',
    status: 'active',
  },
  {
    id: 'deploy-agent',
    label: '模型部署',
    icon: '📦',
    description: 'LLM 驱动模型端侧部署流水线',
    status: 'coming-soon',
  },
]

interface SidebarProps {
  activeModule: ModuleId
  onModuleChange: (id: ModuleId) => void
}

export function Sidebar({ activeModule, onModuleChange }: SidebarProps) {
  const [userModules, setUserModules] = useState<NavModule[]>([])

  useEffect(() => {
    fetch('/api/modules')
      .then((res) => res.json())
      .then((data: any[]) => {
        const user = data
          .filter((m) => m.source === 'user')
          .map((m) => ({
            id: m.key,
            label: m.name,
            icon: m.icon || '🧩',
            description: m.description || '',
            status: 'active' as const,
            source: 'user' as const,
          }))
        setUserModules(user)
      })
      .catch(() => {
        // silently fail — API might not be up during dev
      })
  }, [])

  const allModules = [...MODULES, ...userModules]

  return (
    <aside className="w-60 border-r border-sky-100 bg-white flex flex-col shrink-0 p-4">
      <div className="space-y-1.5 flex-1">
        {allModules.map((mod) => {
          const isActive = activeModule === mod.id
          const isDisabled = mod.status === 'coming-soon'
          return (
            <button
              key={mod.id}
              onClick={() => !isDisabled && onModuleChange(mod.id)}
              disabled={isDisabled}
              className={`
                w-full flex items-center justify-between px-3 py-3 rounded-xl text-xs transition
                ${isActive
                  ? 'bg-sky-50 text-brand-accent font-bold border border-sky-100/70'
                  : isDisabled
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:bg-sky-50/50 hover:text-brand-accent font-semibold'
                }
              `}
            >
              <span className="flex items-center">
                <span className="mr-3 text-sm">{mod.icon}</span>
                <span>{mod.label}</span>
              </span>
              {isDisabled && (
                <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] font-mono">
                  即将上线
                </span>
              )}
            </button>
          )
        })}

      </div>
    </aside>
  )
}
