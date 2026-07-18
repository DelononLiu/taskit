import { Search } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/core/components/StatusBadge'
import { EmptyState } from '@/core/components/EmptyState'
import type { ComparisonTask } from '@/types'

interface TaskTableProps {
  tasks: ComparisonTask[]
  loading?: boolean
  onSelectTask: (task: ComparisonTask) => void
  onNewTask: () => void
  /** 过滤器状态（由父组件控制或本地控制） */
  filterStatus?: string
  onFilterStatusChange?: (v: string) => void
  searchQuery?: string
  onSearchChange?: (v: string) => void
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'completed', label: 'READY' },
  { value: 'pending', label: 'PENDING' },
  { value: 'running', label: 'COMPILING' },
  { value: 'failed', label: 'FAILED' },
]

export function TaskTable({
  tasks,
  loading,
  onSelectTask,
  onNewTask,
  filterStatus,
  onFilterStatusChange,
  searchQuery,
  onSearchChange,
}: TaskTableProps) {
  // 如果父组件不传过滤器状态，使用本地状态
  const [localStatus, setLocalStatus] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const status = filterStatus ?? localStatus
  const setStatus = onFilterStatusChange ?? setLocalStatus
  const search = searchQuery ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch

  const filtered = tasks.filter((t) => {
    if (status && t.status !== status) return false
    if (search && !t.model?.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (!loading && tasks.length === 0) {
    return (
      <EmptyState
        icon="🔬"
        title="尚未创建比对任务"
        description="上传 .onnx 模型文件并选择目标框架，开始分析精度差异"
        actionLabel="新建比对任务"
        onAction={onNewTask}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 过滤栏 */}
      <div className="bg-white p-3.5 rounded-xl border border-sky-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3 text-xs">
          {/* 状态过滤 */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">
            <span className="text-slate-400 font-medium">状态:</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="bg-transparent font-bold text-slate-700 focus:outline-none cursor-pointer text-xs"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型名称..."
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 pl-8 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-brand-accent transition font-medium"
          />
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-2xl border border-sky-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sky-50/40 border-b border-sky-100 text-[10px] font-bold tracking-wider text-slate-400 uppercase font-mono">
                <th className="py-2.5 px-4 pl-6 w-[28%]">模型 / 目标框架</th>
                <th className="py-2.5 px-4 w-[18%]">精度指标</th>
                <th className="py-2.5 px-4 w-[16%]">状态</th>
                <th className="py-2.5 px-4 w-[16%]">完成时间</th>
                <th className="py-2.5 px-4 pr-6 text-right w-[22%]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400 text-xs">
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400 text-xs">
                    无匹配任务
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task)}
                    className="hover:bg-brand-light-bg/40 transition cursor-pointer group"
                  >
                    <td className="py-2.5 px-4 pl-6">
                      <div className="font-bold text-slate-800 font-mono text-xs">
                        {task.model?.name ?? `task_${task.id}`}
                      </div>
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        {(task.frameworks ?? []).map((fw) => (
                          <span
                            key={fw}
                            className="bg-brand-light-bg text-brand-accent font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border border-sky-100"
                          >
                            {fw}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      {task.status === 'completed' ? (
                        <>
                          <div className="text-slate-700 font-semibold">
                            余弦:{' '}
                            <span className="text-brand-success">
                              {task.comparisons?.[0]?.overallMetrics?.avgCosineSimilarity?.toFixed(4) ?? '—'}
                            </span>
                          </div>
                          <div className="text-slate-400 text-[11px] mt-0.5">
                            最大误差:{' '}
                            <b className="text-slate-600 font-medium">
                              {task.comparisons?.[0]?.overallMetrics?.maxAbsError?.toFixed(6) ?? '—'}
                            </b>
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400/60">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 font-mono">
                      {task.completedAt ?? (task.status === 'running' ? '正在执行...' : task.createdAt ?? '—')}
                    </td>
                    <td className="py-2.5 px-4 pr-6 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectTask(task)
                        }}
                        className="text-slate-500 hover:text-brand-accent font-bold px-3 py-2 rounded-lg border border-slate-200 hover:bg-brand-light-bg/50 transition text-xs"
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
