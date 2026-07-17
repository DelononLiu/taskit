import type { ModuleId, NavModule } from '@/core/types'

const MODULES: NavModule[] = [
  {
    id: 'model-diff',
    label: '精度比对',
    icon: '📊',
    description: '神经网络模型精度差异分析',
    status: 'active',
  },
  {
    id: 'deploy-agent',
    label: '部署工坊',
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
  return (
    <aside className="w-60 border-r border-sky-100 bg-white flex flex-col shrink-0 p-4">
      <div className="space-y-1.5 flex-1">
        <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-3 px-2">
          模型工具
        </div>

        {MODULES.map((mod) => {
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
                  ? 'bg-sky-50 text-[#0284c7] font-bold border border-sky-100/70'
                  : isDisabled
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:bg-sky-50/50 hover:text-[#0284c7] font-semibold'
                }
              `}
            >
              <span className="flex items-center">
                <span className="mr-3 text-sm">{mod.icon}</span>
                <span>{mod.label}</span>
              </span>
              {isDisabled && (
                <span className="bg-slate-100 text-slate-500 px-1.5 py-0.2 rounded text-[10px] font-mono">
                  即将上线
                </span>
              )}
            </button>
          )
        })}

        <div className="h-px bg-slate-100 my-4" />

        <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-3 px-2">
          通用
        </div>

        <button
          className="w-full flex items-center px-3 py-3 rounded-xl text-slate-600 hover:bg-sky-50/50 hover:text-[#0284c7] font-semibold text-xs transition group"
        >
          <span className="mr-3 text-sm">📁</span>
          <span>全部任务记录</span>
        </button>

        <button className="w-full flex items-center px-3 py-3 rounded-xl text-slate-600 hover:bg-sky-50/50 hover:text-[#0284c7] font-semibold text-xs transition group">
          <span className="mr-3 text-sm">📄</span>
          <span>导出报告</span>
        </button>
      </div>

      {/* System info */}
      <div className="p-2 bg-sky-50/50 border border-sky-100 rounded-xl">
        <div className="text-[9px] text-sky-400 font-bold uppercase tracking-wider font-mono">
          Backend Node
        </div>
        <div className="text-[11px] text-sky-700 font-mono font-bold mt-0.5">
          10.128.4.15
        </div>
      </div>
    </aside>
  )
}
