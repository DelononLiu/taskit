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
  const status = filterStatus ?? localStatus
  const setStatus = onFilterStatusChange ?? setLocalStatus
  const search = searchQuery ?? localSearch
  const setSearch = onSearchChange ?? setLocalSearch

  // 按任务 ID 逆序排列（号大在前）
  const sorted = [...tasks].sort((a, b) => b.id - a.id)

  const filtered = sorted.filter((t) => {
    if (status && t.status !== status) return false
    if (search && !t.model?.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const fmtDate = (d: string | undefined | null) => {
    if (!d) return '—'
    const ts = typeof d === 'string' ? Date.parse(d) : d
    if (!ts || isNaN(+new Date(ts))) return String(d).slice(0, 19)
    return new Date(ts).toISOString().slice(0, 19).replace('T', ' ')
  }

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
                <th className="py-2 px-1.5 pl-3 w-[44px]">任务号</th>
                <th className="py-2 px-1.5 w-[90px]">模型</th>
                <th className="py-2 px-1.5 w-[90px]">基准框架</th>
                <th className="py-2 px-1.5 w-[76px]">目标框架</th>
                <th className="py-2 px-1 w-[44px]">精度</th>
                <th className="py-2 px-1 w-[44px]">状态</th>
                <th className="py-2 px-1.5 w-[80px]">开始时间</th>
                <th className="py-2 px-1.5 w-[80px]">完成时间</th>
                <th className="py-2 px-1 w-[28px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {loading && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground text-xs">
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground text-xs">
                    无匹配任务
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((task, i) => (
                  <tr
                    key={task.id}
                    onClick={() => onSelectTask(task)}
                    className="hover:bg-brand-light-bg/40 transition cursor-pointer group"
                  >
                    <td className="py-2 px-1.5 pl-3 text-muted-foreground font-mono text-[11px]">
                      {task.id}
                    </td>
                    <td className="py-2 px-1.5">
                      <div className="font-bold text-foreground font-mono text-xs">
                        {task.model?.name ?? '—'}
                      </div>
                    </td>
                    <td className="py-2 px-1.5">
                      <span className="bg-brand-light-bg text-brand-accent font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border border-sky-100">
                        ONNX Runtime
                      </span>
                    </td>
                    <td className="py-2 px-1.5">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(task.frameworks ?? []).filter((fw: string) => fw !== 'onnxruntime').map((fw: string) => (
                          <span
                            key={fw}
                            className="bg-brand-light-bg text-brand-accent font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border border-sky-100"
                          >
                            {fw}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-1 font-mono">
                      {task.status === 'completed' ? (
                        <span className="text-brand-success font-semibold">
                          {task.comparisons?.[0]?.overallMetrics?.avgCosineSimilarity != null
                            ? (task.comparisons[0].overallMetrics.avgCosineSimilarity * 100).toFixed(2) + '%'
                            : '—'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-1 py-2">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="py-2 px-1.5 text-muted-foreground font-mono text-[11px]">
                      {fmtDate(task.createdAt)}
                    </td>
                    <td className="py-2 px-1.5 text-muted-foreground font-mono text-[11px]">
                      {task.status === 'running' ? '—' : fmtDate(task.completedAt)}
                    </td>
                    <td className="py-2 px-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectTask(task)
                        }}
                        className="text-muted-foreground hover:text-brand-accent p-1 rounded-lg hover:bg-brand-light-bg/50 transition"
                        title="查看详情"
                      >
                        <Eye className="h-3.5 w-3.5" />
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
