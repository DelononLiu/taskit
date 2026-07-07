# Taskit Polish Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 7 polish items to the Taskit project: ErrorBoundary, unit tests, task template, loading skeleton, theme toggle fix, barrel exports, mock error messages.

**Architecture:** Small self-contained changes across frontend/src. Each task is independent except Task 1 (vitest setup) which is a prerequisite for Task 2 (unit tests). Tasks can be parallelized otherwise.

**Tech Stack:** React 18, Vite 5, Vitest, TypeScript, Zustand

## Global Constraints

- Default theme is light (uiStore default `theme: 'light'` stays as-is)
- All existing code patterns must be followed (shadcn/ui components, Tailwind classes, import style)
- No unrelated refactoring (the old `src/pages/Tool/index.tsx` is dead code — do NOT modify it)
- All existing docs remain untouched

---

### Task 1: Install vitest + Write Unit Tests for `utils/`

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/utils/__tests__/color.test.ts`
- Create: `src/utils/__tests__/metric.test.ts`

**Interfaces:**
- Consumes: `src/utils/color.ts` (`getFrameworkColor`, `diffToColor`), `src/utils/metric.ts` (`formatMetricValue`, `getPassColor`), `src/types/metric.ts` (`MetricType`)
- Produces: Test coverage for both utility modules

- [ ] **Step 1: Install vitest + jsdom**

```bash
npm install -D vitest jsdom @testing-library/react
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3: Add test script to package.json**

Find the `"scripts"` section and add a test line:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write color.test.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { getFrameworkColor, diffToColor } from '@/utils/color'

describe('getFrameworkColor', () => {
  it('returns blue for onnxruntime', () => {
    expect(getFrameworkColor('onnxruntime')).toBe('#1677ff')
  })

  it('returns purple for tensorrt', () => {
    expect(getFrameworkColor('tensorrt')).toBe('#722ed1')
  })

  it('returns orange for openvino', () => {
    expect(getFrameworkColor('openvino')).toBe('#fa8c16')
  })

  it('returns fallback #666 for unknown framework', () => {
    expect(getFrameworkColor('unknown')).toBe('#666')
  })
})

describe('diffToColor', () => {
  it('returns green when value >= threshold', () => {
    expect(diffToColor(0.995, 0.99)).toBe('#52c41a')
    expect(diffToColor(0.99, 0.99)).toBe('#52c41a')
  })

  it('returns yellow when value >= 90% of threshold', () => {
    expect(diffToColor(0.95, 0.99)).toBe('#faad14')
    expect(diffToColor(0.891, 0.99)).toBe('#faad14')
  })

  it('returns red when value < 90% of threshold', () => {
    expect(diffToColor(0.89, 0.99)).toBe('#ff4d4f')
    expect(diffToColor(0.5, 0.99)).toBe('#ff4d4f')
  })
})
```

- [ ] **Step 5: Write metric.test.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { formatMetricValue, getPassColor } from '@/utils/metric'

describe('formatMetricValue', () => {
  it('formats cosine_similarity to 6 decimal places', () => {
    expect(formatMetricValue('cosine_similarity', 0.999999)).toBe('0.999999')
    expect(formatMetricValue('cosine_similarity', 0.1234567)).toBe('0.123457')
  })

  it('formats error metrics to exponential notation', () => {
    expect(formatMetricValue('max_abs_error', 0.000123)).toBe('1.2300e-4')
    expect(formatMetricValue('mean_abs_error', 0.001)).toBe('1.0000e-3')
    expect(formatMetricValue('relative_error', 0.05)).toBe('5.0000e-2')
  })

  it('formats snr with dB unit', () => {
    expect(formatMetricValue('snr', 44.9)).toBe('44.9 dB')
    expect(formatMetricValue('snr', 3.2)).toBe('3.2 dB')
  })
})

describe('getPassColor', () => {
  it('returns green when passed is true', () => {
    expect(getPassColor(true, true, 0.5, 0.99)).toBe('#52c41a')
    expect(getPassColor(true, false, 0.5, 0.99)).toBe('#52c41a')
  })

  it('returns red when not passed and higherIsBetter with value < threshold', () => {
    expect(getPassColor(false, true, 0.5, 0.99)).toBe('#ff4d4f')
  })

  it('returns yellow when not passed but not the higherIsBetter case', () => {
    expect(getPassColor(false, false, 0.5, 0.99)).toBe('#faad14')
  })
})
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run
```

Expected: All 12+ tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.ts src/utils/__tests__/
git commit -m "test: add vitest + unit tests for utils/color and utils/metric"
```

---

### Task 2: Add Global ErrorBoundary

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `React.ReactNode` (children), `React.ErrorInfo`
- Produces: Graceful error fallback UI that catches rendering crashes anywhere in the app

- [ ] **Step 1: Create ErrorBoundary component**

```typescript
import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-fail/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-fail" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">应用出现异常</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || '发生了意外错误，请尝试刷新页面。'}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border text-xs font-medium hover:bg-accent transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
```

- [ ] **Step 2: Wrap app in main.tsx**

Replace the existing render:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/main.tsx
git commit -m "feat: add global ErrorBoundary component"
```

---

### Task 3: Create Task Template Directory (`_template/`)

**Files:**
- Create: `src/tasks/_template/index.ts`
- Create: `src/tasks/_template/TaskForm.tsx`
- Create: `src/tasks/_template/ResultViewer.tsx`

**Interfaces:**
- Consumes: ModuleDef interface from `src/tasks/registry.ts`
- Produces: A copyable template for creating new task modules

- [ ] **Step 1: Create `_template/TaskForm.tsx`**

```typescript
interface Props {
  onTaskCreated: (taskId: number) => void
}

export function TemplateTaskForm({ onTaskCreated }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        创建一个新任务类型时，复制此目录并根据需要修改 TaskForm 和 ResultViewer。
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Create `_template/ResultViewer.tsx`**

```typescript
interface Props {
  taskId: number
  onNewTask: () => void
}

export function TemplateResultViewer({ taskId }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        任务 #{taskId} — 在此处展示你的任务结果。
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Create `_template/index.ts`**

```typescript
// 新任务模板 — 复制此目录并重命名，然后修改以下三处：
//
// 1. TaskForm.tsx    — 上传什么文件、填什么参数
// 2. ResultViewer.tsx — 结果怎么展示
// 3. index.ts        — 注册名称和图标（见下方）
//
// 然后在 src/tasks/registry.ts 中导入注册：
//
//   import '@/tasks/my_task'
//   MODULES.my_task = { name, icon, TaskForm, ResultViewer }

import { MODULES } from '@/tasks/registry'
import { TemplateTaskForm } from './TaskForm'
import { TemplateResultViewer } from './ResultViewer'

// 取消下方注释并修改为新任务名称即可注册
// MODULES.my_task = {
//   name: '我的任务',
//   icon: 'FileText',
//   TaskForm: TemplateTaskForm,
//   ResultViewer: TemplateResultViewer,
// }
```

- [ ] **Step 4: Commit**

```bash
git add src/tasks/_template/
git commit -m "docs: add task template directory (_template/)"
```

---

### Task 4: Add Loading Skeleton to TaskPage

**Files:**
- Modify: `src/core/pages/TaskPage.tsx`

**Interfaces:**
- Consumes: `getModule` from `@/tasks/registry`
- Produces: Skeleton UI while task data loads (ResultViewer returns null initially)

- [ ] **Step 1: Modify TaskPage.tsx to show skeleton when module or ID is invalid**

Replace the current `TaskPage` with one that shows a skeleton layout instead of just `<div>任务不存在</div>`:

```typescript
import { useParams, useNavigate } from 'react-router-dom'
import { getModule } from '@/tasks/registry'
import '@/tasks/model_diff'

export default function TaskPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const mod = getModule('model_diff')
  const id = idStr ? parseInt(idStr) : NaN

  if (!mod || isNaN(id)) {
    return (
      <div className="h-screen bg-background flex flex-col">
        <div className="h-12 border-b border-border" />
        <div className="flex-1 p-6 space-y-4 animate-pulse">
          <div className="h-4 w-48 bg-muted rounded" />
          <div className="h-20 bg-muted rounded-lg" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-48 bg-muted rounded-lg" />
            <div className="h-48 bg-muted rounded-lg" />
          </div>
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <mod.ResultViewer
      taskId={id}
      onNewTask={() => navigate('/')}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/pages/TaskPage.tsx
git commit -m "feat: add loading skeleton to TaskPage"
```

---

### Task 5: Fix Theme Toggle Icon in TopNav

**Files:**
- Modify: `src/core/components/TopNav.tsx`

**Interfaces:**
- Consumes: `useUIStore` (theme + toggleTheme), `lucide-react` (Moon, Sun icons)
- Produces: Dynamic toggle icon: ☾ when light (click to go dark), ☀ when dark (click to go light)

- [ ] **Step 1: Fix TopNav.tsx theme button**

Current code (line 60):
```tsx
<button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={toggleTheme}>☀</button>
```

Replace with:
```tsx
<button
  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
  onClick={toggleTheme}
  title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
>
  {theme === 'dark' ? '☀' : '☾'}
</button>
```

And add the import for `theme` at the top of the component function:

The TopNav already imports `useUIStore` on line 5. Add `theme` to the destructure:

```typescript
const { toggleTheme } = useUIStore()
```
→
```typescript
const { theme, toggleTheme } = useUIStore()
```

- [ ] **Step 2: Commit**

```bash
git add src/core/components/TopNav.tsx
git commit -m "fix: dynamic theme toggle icon in TopNav (☾ light / ☀ dark)"
```

---

### Task 6: Add Missing Barrel Exports in api/index.ts

**Files:**
- Modify: `src/api/index.ts`

**Interfaces:**
- Produces: All task API functions exported from `@/api` barrel

- [ ] **Step 1: Add missing exports**

Current content:
```typescript
export { uploadModel } from './model'
export { createTask, getTask, getTaskLayers } from './task'
```

Replace with:
```typescript
export { uploadModel } from './model'
export { createTask, getTask, getTaskLayers, cancelTask, retryTask, getTaskHistory } from './task'
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/index.ts
git commit -m "fix: add missing cancelTask/retryTask/getTaskHistory to api barrel exports"
```

---

### Task 7: Add Error Message to Mock Handler for Failed Tasks

**Files:**
- Modify: `src/api/mock/handlers.ts`
- Modify: `src/api/mock/fixtures.ts` (if needed)

**Interfaces:**
- Consumes: `mockApi.getTask` handler
- Produces: Task 3 (BERT) mock returns `error: '推理失败: 模型不兼容'` when status is 'failed'

- [ ] **Step 1: Add mock error message for failed task in fixtures**

Read `src/api/mock/fixtures.ts`:

```typescript
// If MOCK_TASK doesn't already have an error field, skip.
// If it does, set it to null on completed tasks.
```

Actually, the `MOCK_TASK` is what `mockApi.getTask` returns. Let me use the right approach — modify the `getTask` handler to set `error` when the task id is the failed one.

In `src/api/mock/handlers.ts`, modify `getTask`:

```typescript
async getTask(taskId: number): Promise<ComparisonTask> {
  await delay(300)
  if (taskId > 1) {
    const elapsed = Date.now() - new Date(MOCK_TASK.createdAt).getTime()
    const progress = Math.min(100, Math.round((elapsed / 5000) * 100))
    return {
      ...MOCK_TASK,
      id: taskId,
      status: progress >= 100 ? 'completed' : 'running',
      progress,
    }
  }
  return { ...MOCK_TASK, id: taskId }
}
```

Add the error field for failed mock tasks. Since the mock doesn't actually run real tasks, we add logic to return an error for task ID 3 (BERT, which is the failed task in mock data):

```typescript
async getTask(taskId: number): Promise<ComparisonTask> {
  await delay(300)
  // Failed mock task
  if (taskId === 3) {
    return {
      ...MOCK_TASK,
      id: taskId,
      status: 'failed',
      progress: 62,
      error: '推理失败: 模型不兼容 (BertBase 未实现 fused attention)',
    }
  }
  if (taskId > 1) {
    const elapsed = Date.now() - new Date(MOCK_TASK.createdAt).getTime()
    const progress = Math.min(100, Math.round((elapsed / 5000) * 100))
    return {
      ...MOCK_TASK,
      id: taskId,
      status: progress >= 100 ? 'completed' : 'running',
      progress,
    }
  }
  return { ...MOCK_TASK, id: taskId }
}
```

- [ ] **Step 2: Verify Real API path works**

The `ComparisonTask` type already has `error?: string` (in `src/types/task.ts` line 14), so the type system is fine.

- [ ] **Step 3: Commit**

```bash
git add src/api/mock/handlers.ts
git commit -m "fix: add error message to mock handler for failed tasks"
```

---

## Spec Coverage Check

| Spec Item | Task |
|-----------|------|
| ErrorBoundary | Task 2 ✓ |
| Unit tests for utils | Task 1 ✓ |
| `_template/` directory | Task 3 ✓ |
| TaskPage loading skeleton | Task 4 ✓ |
| Theme toggle icon fix | Task 5 ✓ |
| Barrel exports | Task 6 ✓ |
| Mock error messages | Task 7 ✓ |

All 7 items are covered with independent, testable deliverables.
