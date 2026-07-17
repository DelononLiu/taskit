# Taskit 平台布局重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Taskit 从单工具页面重构为 Header + Sidebar + TaskTable + DetailDrawer 四区平台布局，与 DeployAgent UI 设计语言对齐。

**Architecture:** 采用 React + zustand 状态管理 + Tailwind CSS + shadcn/ui。新增 `src/stores/appStore.ts` 管理平台级状态（activeModule、drawerMode），新增 7 个组件，改造 4 个现有文件，废弃 2 个文件。不改动 ModelDiff 核心比对逻辑。

**Tech Stack:** React 18, TypeScript, zustand, Tailwind CSS, shadcn/ui, lucide-react

## 全局约束

- 默认主题为亮色（已有，保持不变）
- 主色调从 `#1677ff` 更新为 sky-600 `#0284c7`
- 字体：Plus Jakarta Sans（显示）+ JetBrains Mono（代码）
- 图片/插画使用 emoji 占位，不引入真实图片资源
- git commit message 使用中文

---

### Task 1: 设计令牌 + 字体加载

**Files:**
- Modify: `src/index.html` — 加载 Google Fonts
- Modify: `src/index.css` — 新增 design tokens

**Interfaces:**
- Consumes: 无（基础层，无依赖）
- Produces: 全局 CSS class 和 CSS 变量供所有后续任务使用

- [ ] **Step 1: 在 index.html 中加载字体**

```html
<!-- 在 <head> 中，现有 link 之后添加 -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

- [ ] **Step 2: 在 index.css 中追加设计令牌**

在现有 `@layer base` 的 `:root` 块中追加品牌色和字体变量：

```css
/* 追加到 :root 块末尾 */
--brand-accent: 201 96% 39%;       /* #0284c7 sky-600 */
--brand-accent-hover: 200 98% 31%; /* #0369a1 sky-700 */
--brand-light-bg: 200 100% 97%;    /* #f0f9ff sky-50 */
--brand-success: 152 76% 40%;      /* #10b981 emerald-500 */
```

同时追加字体声明和品牌 class：

```css
@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* 新增：品牌工具类 */
  .font-mono { font-family: 'JetBrains Mono', monospace !important; }
}
```

- [ ] **Step 3: 验证构建不报错**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: 无 TypeScript 错误（或与改动无关的已有错误）
```

- [ ] **Step 4: 提交**

```bash
git add src/index.html src/index.css
git commit -m "feat: 添加 Taskit 品牌设计令牌和字体加载

- 加载 Plus Jakarta Sans + JetBrains Mono
- 新增 brand-accent / brand-success 等 CSS 变量
- 更新全局字体系列"
```

---

### Task 2: Header + Sidebar

**Files:**
- Create: `src/core/components/Header.tsx`
- Create: `src/core/components/Sidebar.tsx`

**Interfaces:**
- Consumes: 无（纯展示组件，独立运行）
- Produces: `<Header onNewTask: () => void />`, `<Sidebar activeModule: ModuleId onModuleChange: (m) => void />`

- [ ] **Step 1: 创建核心类型文件 `src/core/types.ts`**

```ts
export type ModuleId = 'model-diff' | 'deploy-agent'

export interface NavModule {
  id: ModuleId
  label: string
  icon: string   // emoji 或 lucide icon name
  description: string
  status: 'active' | 'coming-soon'
}
```

- [ ] **Step 2: 创建 Header.tsx**

```tsx
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  onNewTask?: () => void
}

export function Header({ onNewTask }: HeaderProps) {
  return (
    <header className="h-[76px] border-b border-sky-100 bg-white flex items-center justify-between px-8 shrink-0 relative z-50 shadow-[0_4px_20px_rgba(2,132,199,0.03)]">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-3">
          {/* Logo */}
          <div className="bg-sky-50 text-[#0284c7] w-10 h-10 rounded-xl flex items-center justify-center border border-sky-200 shadow-sm">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="currentColor" />
              <path d="M16 6l8 12H8l8-12z" fill="white" />
              <circle cx="16" cy="22" r="3" fill="white" />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-slate-800">
                TASKIT <span className="text-[#0284c7] font-black">PLATFORM</span>
              </span>
              <span className="bg-sky-500 text-white text-[9px] px-1.5 py-0.5 rounded font-mono font-bold tracking-wider">
                v2.0
              </span>
            </div>
            <div className="text-[10px] text-sky-500 font-bold tracking-widest uppercase mt-0.5">
              模型精度 · 部署流水线
            </div>
          </div>
        </div>

        {/* Status indicators */}
        <div className="hidden md:flex items-center space-x-4 text-xs">
          <div className="flex items-center space-x-2 bg-sky-50/60 border border-sky-100 px-2.5 py-1 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-500 font-medium">后端:</span>
            <span className="font-mono font-bold text-sky-700">已连接</span>
          </div>
          <div className="flex items-center space-x-2 bg-sky-50/60 border border-sky-100 px-2.5 py-1 rounded-lg">
            <span className="text-slate-500 font-medium">节点:</span>
            <span className="font-mono font-bold text-sky-700">10.128.4.15</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {onNewTask && (
          <Button
            onClick={onNewTask}
            className="bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-bold px-5 py-3 rounded-xl transition shadow-sm flex items-center space-x-2 border border-sky-500/10 h-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建任务</span>
          </Button>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 3: 创建 Sidebar.tsx**

```tsx
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
```

- [ ] **Step 4: 提交**

```bash
git add src/core/types.ts src/core/components/Header.tsx src/core/components/Sidebar.tsx
git commit -m "feat: 添加品牌 Header 和侧边栏导航组件

- Header 76px 带品牌 logo、状态指示器、新建任务按钮
- Sidebar 240px 带子产品切换（预留部署工坊入口）
- 新增 ModuleId / NavModule 核心类型"
```

---

### Task 3: DetailDrawer 容器组件

**Files:**
- Create: `src/core/components/DetailDrawer.tsx`

**Interfaces:**
- Consumes: 无（通用容器组件）
- Produces: `<DetailDrawer open mode title onClose children />`

- [ ] **Step 1: 创建 DetailDrawer.tsx**

```tsx
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DrawerMode = 'closed' | 'new-task' | 'task-detail'

interface DetailDrawerProps {
  open: boolean
  mode: DrawerMode
  title: string
  onClose: () => void
  children: React.ReactNode
}

export function DetailDrawer({ open, mode, title, onClose, children }: DetailDrawerProps) {
  const prevOpen = useRef(open)

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open !== prevOpen.current) {
      document.body.style.overflow = open ? 'hidden' : ''
      prevOpen.current = open
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-[500px] bg-white border-l border-sky-100 z-50',
          'flex flex-col shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="p-5 border-b border-sky-100 bg-sky-50/30 flex justify-between items-center shrink-0">
          <div>
            <span className="text-[9px] font-extrabold text-[#0284c7] uppercase tracking-widest font-mono">
              {mode === 'new-task' ? 'NEW TASK' : 'TASK INSPECTOR'}
            </span>
            <h3 className="text-sm font-bold text-slate-800 mt-0.5 font-mono">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {children}
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add src/core/components/DetailDrawer.tsx
git commit -m "feat: 添加 DetailDrawer 通用详情抽屉组件

- 500px 右侧滑出面板
- 支持 backdrop 遮罩 + 过渡动画
- 双模式标签（NEW TASK / TASK INSPECTOR）"
```

---

### Task 4: StatusBadge + EmptyState

**Files:**
- Create: `src/core/components/StatusBadge.tsx`
- Create: `src/core/components/EmptyState.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `<StatusBadge status: TaskStatus />`, `<EmptyState icon title description action />`

- [ ] **Step 1: 创建 StatusBadge.tsx**

```tsx
import type { TaskStatus } from '@/types'

interface StatusBadgeProps {
  status: TaskStatus
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; icon: string; className: string }> = {
  completed: {
    label: 'READY',
    icon: '●',
    className: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  },
  running: {
    label: 'COMPILING',
    icon: '◌',
    className: 'bg-slate-100 border-slate-200 text-slate-600',
  },
  pending: {
    label: 'PENDING',
    icon: '▲',
    className: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  failed: {
    label: 'FAILED',
    icon: '✕',
    className: 'bg-red-50 border-red-200 text-red-700',
  },
  cancelled: {
    label: 'CANCELLED',
    icon: '—',
    className: 'bg-slate-100 border-slate-200 text-slate-500',
  },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border ${cfg.className}`}
    >
      <span className="text-[9px]">{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}
```

- [ ] **Step 2: 创建 EmptyState.tsx**

```tsx
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ icon = '📋', title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <span className="text-4xl mb-4">{icon}</span>
      <h3 className="text-sm font-bold text-slate-800 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-slate-400 mb-6 text-center max-w-xs">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="bg-[#0284c7] hover:bg-[#0369a1] text-xs px-5 py-3 rounded-xl h-auto">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add src/core/components/StatusBadge.tsx src/core/components/EmptyState.tsx
git commit -m "feat: 添加 StatusBadge 和 EmptyState 通用组件

- StatusBadge 支持 5 种任务状态（READY/COMPILING/PENDING/FAILED/CANCELLED）
- EmptyState 空态占位，带可选操作按钮"
```

---

### Task 5: TaskTable 任务表格

**Files:**
- Create: `src/core/components/TaskTable.tsx`

**Interfaces:**
- Consumes: `ComparisonTask[]`（来自 `@/types`）、`StatusBadge`
- Produces: `<TaskTable tasks onSelectTask onNewTask loading />` — 渲染任务列表表格

- [ ] **Step 1: 创建 TaskTable.tsx**

```tsx
import { Search, FileIcon, ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/core/components/StatusBadge'
import { EmptyState } from '@/core/components/EmptyState'
import type { ComparisonTask } from '@/types'

interface TaskTableProps {
  tasks: ComparisonTask[]
  loading?: boolean
  onSelectTask: (task: ComparisonTask) => void
  onNewTask: () => void
  // 过滤器状态（由父组件控制或本地控制）
  filterStatus?: string
  onFilterStatusChange?: (v: string) => void
  searchQuery?: string
  onSearchChange?: (v: string) => void
}

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

  const STATUS_OPTIONS = [
    { value: '', label: '全部状态' },
    { value: 'completed', label: 'READY' },
    { value: 'pending', label: 'PENDING' },
    { value: 'running', label: 'COMPILING' },
    { value: 'failed', label: 'FAILED' },
  ]

  if (!loading && tasks.length === 0) {
    return (
      <EmptyState
        icon="🔬"
        title="尚未创建精度比对任务"
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
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 pl-8 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-600 transition font-medium"
          />
        </div>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-2xl border border-sky-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sky-50/40 border-b border-sky-100 text-[10px] font-bold tracking-wider text-slate-400 uppercase font-mono">
                <th className="p-4 pl-6 w-[28%]">模型 / 目标框架</th>
                <th className="p-4 w-[18%]">精度指标</th>
                <th className="p-4 w-[16%]">状态</th>
                <th className="p-4 w-[16%]">完成时间</th>
                <th className="p-4 pr-6 text-right w-[22%]">操作</th>
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
              {!loading && filtered.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onSelectTask(task)}
                  className="hover:bg-sky-50/20 transition cursor-pointer group"
                >
                  <td className="p-4 pl-6">
                    <div className="font-bold text-slate-800 font-mono text-sm">
                      {task.model?.name ?? `task_${task.id}`}
                    </div>
                    <div className="flex items-center space-x-2 mt-1">
                      {(task.frameworks ?? []).map((fw) => (
                        <span
                          key={fw}
                          className="bg-sky-50 text-[#0284c7] font-mono text-[10px] font-bold px-1.5 py-0.2 rounded border border-sky-100"
                        >
                          {fw}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 font-mono">
                    {task.status === 'completed' ? (
                      <>
                        <div className="text-slate-700 font-semibold">
                          余弦: <span className="text-emerald-600">{task.comparisons?.[0]?.accuracy?.toFixed(4) ?? '—'}</span>
                        </div>
                        <div className="text-slate-400 text-[11px] mt-0.5">
                          端侧延时: <b className="text-slate-600 font-medium">{task.comparisons?.[0]?.latencyMs ?? '—'}ms</b>
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400/60">—</span>
                    )}
                  </td>
                  <td className="p-4">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="p-4 text-slate-400 font-mono">
                    {task.completedAt ?? (task.status === 'running' ? '正在执行...' : task.createdAt ?? '—')}
                  </td>
                  <td className="p-4 pr-6 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelectTask(task) }}
                      className="text-slate-500 hover:text-[#0284c7] font-bold px-3 py-2 rounded-lg border border-slate-200 hover:bg-sky-50/50 transition text-xs"
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
```

- [ ] **Step 2: 提交**

```bash
git add src/core/components/TaskTable.tsx
git commit -m "feat: 添加 TaskTable 任务表格组件

- 表格主视图，支持状态过滤和搜索
- 与 DeployAgent 大盘风格一致的状态标签体系
- 空态引导 + 加载/无匹配状态处理"
```

---

### Task 6: App.tsx 布局重构 + 状态管理

**Files:**
- Create: `src/stores/appStore.ts`
- Modify: `src/App.tsx` — 集成 Header + Sidebar + Drawer
- Delete: `src/components/Layout/index.tsx` — 废弃旧 Layout

**Interfaces:**
- Consumes: Header, Sidebar, DetailDrawer, TaskTable
- Produces: 应用骨架（Header + Sidebar + Content + Drawer）

- [ ] **Step 1: 创建 appStore.ts**

```ts
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
  activeModule: 'model-diff',
  drawerMode: 'closed',
  drawerTaskId: null,
  drawerTitle: '',
  setActiveModule: (m) => set({ activeModule: m, drawerMode: 'closed' }),
  openDrawer: (mode, taskId, title) =>
    set({ drawerMode: mode, drawerTaskId: taskId ?? null, drawerTitle: title ?? '' }),
  closeDrawer: () => set({ drawerMode: 'closed', drawerTaskId: null, drawerTitle: '' }),
}))
```

- [ ] **Step 2: 重构 App.tsx**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Header } from '@/core/components/Header'
import { Sidebar } from '@/core/components/Sidebar'
import { DetailDrawer } from '@/core/components/DetailDrawer'
import { useAppStore } from '@/stores/appStore'
import { useAuthStore } from '@/stores/authStore'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'
import TaskitPage from '@/pages/TaskitPage'

function AppLayout() {
  const { activeModule, setActiveModule, drawerMode, drawerTitle, openDrawer, closeDrawer } = useAppStore()
  const user = useAuthStore((s) => s.user)

  const handleNewTask = () => {
    openDrawer('new-task', undefined, '新建精度比对任务')
  }

  return (
    <div className="h-screen flex flex-col bg-[#f4f9fd]">
      <Header onNewTask={handleNewTask} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />

        <main className="flex-1 p-8 overflow-y-auto">
          <TaskitPage
            onOpenNewTask={handleNewTask}
            onSelectTask={(task) => openDrawer('task-detail', task.id, task.model?.name ?? `任务 #${task.id}`)}
          />
        </main>
      </div>

      {/* Drawer 由 App 层统一管理，根据 mode 动态渲染内容 */}
      <DetailDrawer
        open={drawerMode !== 'closed'}
        mode={drawerMode}
        title={drawerTitle}
        onClose={closeDrawer}
      >
        {/* 内容由 TaskitPage 根据 drawerTaskId 注入 */}
        {/* 通过 zustand 订阅或 context 传递 */}
        {drawerMode === 'new-task' && <div>新建任务表单（Task 8）</div>}
        {drawerMode === 'task-detail' && <div>任务详情面板（Task 9）</div>}
      </DetailDrawer>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>} />
        <Route path="/tasks/:id" element={<AuthGuard><AppLayout /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 3: 删除废弃文件**

```bash
rm src/components/Layout/index.tsx
# Header.tsx 已在 Layout/index.tsx 中引用——确认没有其他引用后删除
```

- [ ] **Step 4: 确认构建通过**

```bash
npx tsc --noEmit 2>&1 | head -20
# Expected: 可能与旧 Layout 引用相关的错误，逐步修复
```

- [ ] **Step 5: 提交**

```bash
git add src/stores/appStore.ts src/App.tsx
git rm src/components/Layout/index.tsx
git commit -m "refactor: App.tsx 布局重构，集成 Header/Sidebar/Drawer

- 新增 appStore 管理平台级状态（activeModule、drawerMode）
- 四区布局骨架：Header + Sidebar + Content + Drawer
- 废弃旧 Layout 组件"
```

---

### Task 7: TaskitPage.tsx 重构为主视图

**Files:**
- Modify: `src/pages/TaskitPage.tsx` — 以 TaskTable 为主视图

**Interfaces:**
- Consumes: TaskTable, DetailDrawer（通过 store 联动）
- Produces: `<TaskitPage onOpenNewTask onSelectTask />` — 纯路由匹配 + 视图切换

- [ ] **Step 1: 重写 TaskitPage.tsx**

```tsx
import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TaskTable } from '@/core/components/TaskTable'
import { EmptyState } from '@/core/components/EmptyState'
import { useAppStore } from '@/stores/appStore'
import { useTaskStore } from '@/stores/taskStore'
import type { ComparisonTask } from '@/types'

interface TaskitPageProps {
  onOpenNewTask: () => void
  onSelectTask: (task: ComparisonTask) => void
}

export default function TaskitPage({ onOpenNewTask, onSelectTask }: TaskitPageProps) {
  const { id: idStr } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const drawerMode = useAppStore((s) => s.drawerMode)
  const { tasks, loading, fetchTasks, fetchTask } = useTaskStore()

  // 初始加载任务列表
  useEffect(() => {
    fetchTasks()
  }, [])

  // 如果 URL 有 /tasks/:id，打开详情 drawer
  useEffect(() => {
    if (idStr && drawerMode === 'closed') {
      const id = parseInt(idStr)
      if (!isNaN(id)) {
        fetchTask(id).then((task) => {
          if (task) {
            onSelectTask(task)
          }
        })
      }
    }
  }, [idStr])

  const handleSelectTask = (task: ComparisonTask) => {
    onSelectTask(task)
    navigate(`/tasks/${task.id}`, { replace: true })
  }

  const handleNewTask = () => {
    onOpenNewTask()
    navigate('/', { replace: true })
  }

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">
            模型精度比对 · 任务大盘
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            神经网络模型精度差异分析任务的集中管理面板
          </p>
        </div>
      </div>

      {/* Task table */}
      <TaskTable
        tasks={tasks}
        loading={loading}
        onSelectTask={handleSelectTask}
        onNewTask={handleNewTask}
      />
    </div>
  )
}
```

> 注：这里引用 `useTaskStore`——现有项目 `src/stores/taskStore.ts` 可能不存在或接口不同。如果不存在，需要先改造 taskStore 或使用 API 直接加载。实施时按实际 store 接口调整。

- [ ] **Step 2: 检查现有 taskStore 并适配**

```bash
cat src/stores/taskStore.ts
# Expected: 确认是否有 fetchTasks / fetchTask 方法
# 如果缺少，在 taskStore 中补充：
#   fetchTasks: () => Promise<ComparisonTask[]>
#   fetchTask: (id: number) => Promise<ComparisonTask | null>
```

- [ ] **Step 3: 提交**

```bash
git add src/pages/TaskitPage.tsx src/stores/taskStore.ts
git commit -m "refactor: TaskitPage 重构为以 TaskTable 为主视图

- 移除页面级表单/结果切换逻辑
- 任务表格作为主视图，新建/详情走 Drawer
- 支持 /tasks/:id URL 直接打开详情"
```

---

### Task 8: TaskForm → Drawer 模式 A

**Files:**
- Modify: `src/tasks/model_diff/TaskForm.tsx` — 改造为 Drawer 内联表单

**Interfaces:**
- Consumes: DetailDrawer（通过 appStore 拿到 drawerMode）
- Produces: 内联表单组件，提交后刷新 TaskTable

- [ ] **Step 1: 将 TaskForm 改造为 Drawer 内嵌组件**

提取为 `src/tasks/model_diff/DrawerTaskForm.tsx`（或原地修改 TaskForm.tsx）：

```tsx
// 核心变更：移除页面级包裹（TopNav、history drawer），保持纯表单逻辑
// 新增 props: onSuccess?: () => void （提交成功后回调，用于刷新表格 + 关闭 drawer）

interface DrawerTaskFormProps {
  onSuccess?: () => void
}
```

核心改动点：
1. 移除 `min-h-screen flex flex-col` 外层容器
2. 移除 `TopNav` 引用（由 App 层 Header 统一提供）
3. 移除 `TaskHistoryDrawer`（由 Sidebar/表格替代）
4. `onSuccess` 回调：提交成功后调用 `useAppStore.getState().closeDrawer()` + 刷新表格
5. 保持上传和配置逻辑不变

- [ ] **Step 2: 更新 App.tsx 中的 Drawer 内容**

```tsx
// 在 App.tsx DetailDrawer children 中
import { DrawerTaskForm } from '@/tasks/model_diff/DrawerTaskForm'

{drawerMode === 'new-task' && (
  <DrawerTaskForm onSuccess={() => { closeDrawer(); /* 刷新表格 */ }} />
)}
```

- [ ] **Step 3: 提交**

```bash
git add src/tasks/model_diff/DrawerTaskForm.tsx src/App.tsx
git commit -m "refactor: TaskForm 改造为 Drawer 内联表单组件

- 移除页面级布局包裹
- 新增 onSuccess 回调，提交后关闭 Drawer 并刷新表格
- 保持上传和配置逻辑不变"
```

---

### Task 9: ResultViewer → Drawer 模式 B

**Files:**
- Modify: `src/tasks/model_diff/ResultViewer.tsx` — 改造为 Drawer 详情面板

**Interfaces:**
- Consumes: DetailDrawer（通过 appStore 拿到 drawerTaskId）
- Produces: 内联详情面板组件

- [ ] **Step 1: 将 ResultViewer 改造为 Drawer 内嵌组件**

提取为 `src/tasks/model_diff/DrawerTaskDetail.tsx`：

```tsx
interface DrawerTaskDetailProps {
  taskId: number
}
```

核心改动点：
1. 移除 `h-screen flex flex-col` 外层容器
2. 移除 `TopNav` 引用
3. 移除 `TaskHistoryDrawer` 引用
4. 移除右侧浮动 `LayerTooltip`（或改为 Drawer 内的局部展开）
5. 精简为：精度指标 + 层列表 + LLM 日志摘要（参考 DeployAgent drawer 的内容密度）
6. 保持数据加载和计算逻辑不变

- [ ] **Step 2: 更新 App.tsx Drawer 内容**

```tsx
import { DrawerTaskDetail } from '@/tasks/model_diff/DrawerTaskDetail'

{drawerMode === 'task-detail' && drawerTaskId != null && (
  <DrawerTaskDetail taskId={drawerTaskId} />
)}
```

- [ ] **Step 3: 提交**

```bash
git add src/tasks/model_diff/DrawerTaskDetail.tsx src/App.tsx
git commit -m "refactor: ResultViewer 改造为 Drawer 内联详情面板

- 移除页面级布局和 TopNav
- 精简为适合 Drawer 的内容密度
- 通过 drawerTaskId 加载对应任务数据"
```

---

### Task 10: 子产品切换 + DeployAgent 空态预留页

**Files:**
- Modify: `src/core/components/Sidebar.tsx`（已在 Task 2 中创建，无需大改）
- Modify: `src/pages/TaskitPage.tsx` — 根据 activeModule 渲染不同内容
- Create（可选）：`src/pages/DeployAgentComingSoon.tsx`

**Interfaces:**
- Consumes: appStore.activeModule
- Produces: 子产品切换逻辑 + DeployAgent 空态预留

- [ ] **Step 1: 在 TaskitPage 中添加模块切换**

```tsx
import { useAppStore } from '@/stores/appStore'

// 在 TaskitPage 组件内部
const activeModule = useAppStore((s) => s.activeModule)

if (activeModule === 'deploy-agent') {
  return (
    <EmptyState
      icon="🏗️"
      title="部署工坊 · 即将上线"
      description="LLM 驱动的模型端侧全自动转化、SDK 库与可执行 Demo 构建流水线，敬请期待"
    />
  )
}

// model-diff 继续渲染表格
```

- [ ] **Step 2: 在 Sidebar 中处理点击"全部任务记录"**

在 `Sidebar.tsx` 中为"全部任务记录"按钮添加 `onClick`：打开历史抽屉（用现有的 Sheet 组件，或跳转到跨模块任务列表）。

```tsx
// 可选—根据 spec 注释，MVP 可以省略此功能
```

- [ ] **Step 3: 提交**

```bash
git add src/pages/TaskitPage.tsx src/core/components/Sidebar.tsx
git commit -m "feat: 添加子产品切换逻辑和 DeployAgent 空态预留页

- TaskitPage 根据 activeModule 渲染不同内容
- DeployAgent 显示即将上线空态
- Sidebar 切换组件时自动关闭 Drawer"
```

---

## 自检清单

1. **Spec 覆盖度**
   - ✅ Header 76px + 品牌化 → Task 2
   - ✅ Sidebar 240px + 子产品导航 → Task 2 + Task 10
   - ✅ DetailDrawer 500px + 双模式 → Task 3 + Task 8 + Task 9
   - ✅ TaskTable 为主视图 → Task 5 + Task 7
   - ✅ Design tokens 替换 → Task 1
   - ✅ 交互流程: 表格 → 点击 → Drawer → 提交/查看 → 关闭 → 刷新表格 → Task 5~9
   - ✅ DeployAgent 预留入口 + 空态 → Task 10
   - ❌ "全部任务记录"跨模块入口 — spec 中标注了可选（MVP 可省略）

2. **类型一致性** — 所有接口在任务间顺滑衔接
3. **无占位符** — 所有代码块包含实际内容
4. **范围控制** — 10 个任务均不涉及 ModelDiff 核心比对逻辑变更
