import { Search, Eye, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const status = filterStatus ?? localStatus
  const setStatus = onFilterStatusChange ?? setLocalStatus
  const search = searchQuery ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch

  const filtered = tasks.filter((t) => {
    if (status && t.status !== status) return false
    if (search && !t.model?.name.toLowerCase().includes(search.toLowerCase())) return false
    if (startDate && t.createdAt && new Date(t.createdAt) < new Date(startDate)) return false
    if (endDate && t.createdAt && new Date(t.createdAt) > new Date(endDate + 'T23:59:59')) return false
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
      <div className="bg-background p-3.5 rounded-xl border border-sky-100 shadow-xs flex flex-wrap items-center gap-3">
        {/* 搜索框 */}
        <div className="relative w-56">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型名称..."
            className="w-full bg-muted border border-border rounded-lg px-2.5 pl-8 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-brand-accent transition font-medium"
          />
        </div>

        {/* 状态过滤 */}
        <div className="flex items-center space-x-1.5 bg-muted border border-border px-3 py-2 rounded-lg text-xs">
          <span className="text-muted-foreground font-medium">状态:</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-transparent font-bold text-foreground focus:outline-none cursor-pointer text-xs"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 时间过滤 */}
        <div className="flex items-center gap-1.5 text-xs">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-muted border border-border rounded-lg px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-brand-accent transition font-medium"
          />
          <span className="text-muted-foreground">—</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-muted border border-border rounded-lg px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-brand-accent transition font-medium"
          />
        </div>

        {/* 新建按钮 */}
        <Button
          onClick={onNewTask}
          className="bg-brand-accent hover:bg-brand-accent-hover text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm flex items-center gap-1.5 border border-sky-500/10 h-auto shrink-0 ml-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>新建比对</span>
        </Button>
      </div>

      {/* 表格 */}
      <div className="bg-background rounded-2xl border border-sky-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b border-sky-100 text-[10px] font-bold tracking-wider text-muted-foreground uppercase font-mono">
                <th className="py-2.5 px-4 pl-6 w-[30%]">模型 / 目标框架</th>
                <th className="py-2.5 px-4 w-[20%]">精度指标</th>
                <th className="py-2.5 px-4 w-[16%]">状态</th>
                <th className="py-2.5 px-4 w-[16%]">完成时间</th>
                <th className="py-2.5 px-2 w-[60px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {loading && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground text-xs">
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground text-xs">
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
                      <div className="font-bold text-foreground font-mono text-xs">
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
                          <div className="text-foreground font-semibold">
                            余弦:{' '}
                            <span className="text-brand-success">
                              {task.comparisons?.[0]?.overallMetrics?.avgCosineSimilarity?.toFixed(4) ?? '—'}
                            </span>
                          </div>
                          <div className="text-muted-foreground text-[11px] mt-0.5">
                            最大误差:{' '}
                            <b className="text-muted-foreground font-medium">
                              {task.comparisons?.[0]?.overallMetrics?.maxAbsError?.toFixed(6) ?? '—'}
                            </b>
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground font-mono">
                      {task.completedAt ?? (task.status === 'running' ? '正在执行...' : task.createdAt ?? '—')}
                    </td>
                    <td className="py-2.5 px-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectTask(task)
                        }}
                        className="text-muted-foreground hover:text-brand-accent p-1.5 rounded-lg hover:bg-brand-light-bg/50 transition"
                        title="查看详情"
                      >
                        <Eye className="h-4 w-4" />
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
