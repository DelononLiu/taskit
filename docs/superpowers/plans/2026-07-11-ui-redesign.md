# Taskit UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge upload/config/results into a single page with three-column framework selector, multi-column result table, floating layer tooltip, toast notifications, polling lifecycle fix, and mock data completion.

**Architecture:** Tasks 1-3 refactor the existing `TaskForm.tsx` (config area). Task 4 creates the unified page merging the routing. Tasks 5-7 refactor the results display. Task 8 adds the toast system. Each task ends with a working, type-checked commit.

**Tech Stack:** React 18, TypeScript, Vite 5, Tailwind CSS, shadcn/ui, @radix-ui/react-toast (already installed)

## Global Constraints

- Default theme is light; theme preference persists to localStorage (already implemented)
- No mobile responsiveness needed
- No page navigation between upload and results — everything on same page
- URL routing: `/` for main page, `/tasks/:id` for direct task access (same component)

---

### Task 1: Install Toast Dependency + Create Toast Provider

**Files:**
- Create: `src/components/ui/toast.tsx` — custom toast hook using `@radix-ui/react-toast`
- Create: `src/components/ui/toaster.tsx` — the toast renderer component

**Interfaces:**
- Consumes: `@radix-ui/react-toast` (already in `package.json`)
- Produces: `useToast()` hook exporting `toast({ title, description, variant?: 'default'|'destructive' })` and `<Toaster />` component

- [ ] **Step 1: Check @radix-ui/react-toast is installed**

```bash
node -e "require('@radix-ui/react-toast')" && echo "OK"
```

Expected: "OK"

- [ ] **Step 2: Create `src/components/ui/toast.tsx`**

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'

interface Toast {
  id: string
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...t, id }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastPrimitive.Provider swipeDirection="right">
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            className={cn(
              'fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-3 shadow-lg text-sm',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out',
              t.variant === 'destructive'
                ? 'border-fail/30 bg-fail/10 text-fail'
                : 'border-border bg-card text-foreground'
            )}
          >
            <ToastPrimitive.Title className="font-medium text-sm">{t.title}</ToastPrimitive.Title>
            {t.description && (
              <ToastPrimitive.Description className="text-xs text-muted-foreground mt-0.5">
                {t.description}
              </ToastPrimitive.Description>
            )}
            <ToastPrimitive.Close className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
              ✕
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

import { cn } from '@/lib/utils'
```

- [ ] **Step 3: Wrap app in `ToastProvider` in `src/main.tsx`**

```typescript
// Add import:
import { ToastProvider } from '@/components/ui/toast'

// Wrap app:
<React.StrictMode>
  <ErrorBoundary>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ErrorBoundary>
</React.StrictMode>
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/toast.tsx src/main.tsx
git commit -m "feat: add ToastProvider with @radix-ui/react-toast"
```

---

### Task 2: Fix Polling Lifecycle in TaskForm

**Files:**
- Modify: `src/tasks/model_diff/TaskForm.tsx` (lines 93-117, the polling `setInterval` inside `handleRun`)

**Interfaces:**
- Consumes: `getTask` from `@/api/task`
- Produces: Polling that self-cleans when component unmounts

- [ ] **Step 1: Refactor the polling section in `handleRun`** (around line 88-117)

Replace this code:

```typescript
      // Phase 3: poll for results
      const poll = setInterval(async () => {
        try {
          const updated = await getTask(t.id)
          setTask(updated)
          setLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] ${comparisonFws.join('/')} 执行中 ${updated.progress}%`,
          ])
          if (updated.status === 'completed') {
            clearInterval(poll)
            setRunning(false)
            onTaskCreated(t.id)
          }
          if (updated.status === 'failed') {
            clearInterval(poll)
            setRunning(false)
          }
        } catch (e) {
          console.error('poll error', e)
        }
      }, 1500)
```

With:

```typescript
      // Phase 3: poll for results
      const pollRef = { current: true }
      pollRefsRef.current = pollRefsRef.current || new Map()
      pollRefsRef.current.set(t.id, pollRef)

      const poll = async () => {
        if (!pollRef.current) return
        try {
          const updated = await getTask(t.id)
          if (!pollRef.current) return
          setTask(updated)
          setLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] ${comparisonFws.join('/')} 执行中 ${updated.progress}%`,
          ])
          if (updated.status === 'completed' || updated.status === 'failed') {
            setRunning(false)
            if (updated.status === 'completed') onTaskCreated(t.id)
            pollRefsRef.current?.delete(t.id)
            return
          }
          setTimeout(poll, 1500)
        } catch (e) {
          console.error('poll error', e)
          if (pollRef.current) setTimeout(poll, 1500)
        }
      }
      poll()
```

Add a `useEffect` cleanup at the top of the component function (after hooks):

```typescript
  const pollRefsRef = useRef<Map<number, { current: boolean }>>(new Map())
  useEffect(() => {
    return () => {
      // Cleanup all active polls on unmount
      pollRefsRef.current.forEach((ref) => { ref.current = false })
      pollRefsRef.current.clear()
    }
  }, [])
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/tasks/model_diff/TaskForm.tsx
git commit -m "fix: replace setInterval polling with safe setTimeout + cleanup"
```

---

### Task 3: Add Mock GraphData for ExecutionTree

**Files:**
- Modify: `src/tasks/model_diff/mockData.ts`

**Interfaces:**
- Consumes: `GraphData` type from `@/types`
- Produces: Mock graph data exported for use in mock handler and buildMockTask

- [ ] **Step 1: Add mock graph data to `mockData.ts`**

Append to the end of `mockData.ts`:

```typescript
import type { GraphData } from '@/types'

export const MOCK_GRAPH_DATA: GraphData = {
  nodes: [
    { name: 'input', opType: 'Input', depth: 0, isLeaf: false, cosineSimilarity: null },
    { name: 'conv_1', opType: 'Conv', depth: 1, isLeaf: false, cosineSimilarity: 0.999999 },
    { name: 'conv_23', opType: 'Conv', depth: 2, isLeaf: false, cosineSimilarity: 0.920400 },
    { name: 'relu_1', opType: 'Relu', depth: 2, isLeaf: false, cosineSimilarity: 0.999998 },
    { name: 'fc_output', opType: 'Gemm', depth: 3, isLeaf: true, cosineSimilarity: 0.999997 },
  ],
  edges: [
    { from: 'input', to: 'conv_1' },
    { from: 'conv_1', to: 'conv_23' },
    { from: 'conv_1', to: 'relu_1' },
    { from: 'conv_23', to: 'fc_output' },
    { from: 'relu_1', to: 'fc_output' },
  ],
  outputs: ['fc_output'],
}
```

Note: add `import type { GraphData } from '@/types'` at the top if not already there. Since the file only imports from `@/types`, check if this import already covers GraphData — it currently imports `LayerDiff, ComparisonTask`. Add `GraphData` to the import.

```typescript
import type { LayerDiff, ComparisonTask, GraphData } from '@/types'
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/tasks/model_diff/mockData.ts
git commit -m "feat: add mock graph data for ExecutionTree rendering"
```

---

### Task 4: Collapse "更多推理配置" + Rename

**Files:**
- Modify: `src/tasks/model_diff/TaskForm.tsx`

**Interfaces:**
- Consumes: Existing config state (batchSize, precision, inputSource, inputText)
- Produces: Same state, just visually collapsed under `<details>`

- [ ] **Step 1: Wrap the config section in `<details>`**

In `TaskForm.tsx`, find the config section starting with the label `配置比对参数` and ending before the button `开始分析`. Replace it with:

```typescript
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">配置比对参数</p>
                <div className="grid grid-cols-2 gap-3">
                  {/* ...keep existing framework selectors unchanged... */}
                </div>

                {/* 更多推理配置 — collapsed by default */}
                <details className="group">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none list-none flex items-center gap-1">
                    <span className="transition-transform group-open:rotate-90">▶</span>
                    更多推理配置
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {/* Batch size */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Batch Size</label>
                      <Select value={batchSize} onValueChange={setBatchSize}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 4, 8, 16, 32].map((v) => (
                            <SelectItem key={v} value={String(v)} className="text-xs">{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Precision */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">推理精度</label>
                      <Select value={precision} onValueChange={setPrecision}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto" className="text-xs">AUTO</SelectItem>
                          <SelectItem value="fp32" className="text-xs">FP32（全精度）</SelectItem>
                          <SelectItem value="fp16" className="text-xs">FP16（半精度）</SelectItem>
                          <SelectItem value="int8" className="text-xs">INT8（熵校准）</SelectItem>
                          <SelectItem value="uint8" className="text-xs">UINT8</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Input source */}
                    <div className="space-y-1.5 col-span-2">
                      <label className="text-xs text-muted-foreground">输入数据</label>
                      <div className="flex flex-wrap gap-2">
                        {(['random', 'text', 'file'] as const).map((src) => (
                          <button key={src} onClick={() => setInputSource(src)}
                            className={cn('px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                              inputSource === src ? 'bg-accent border-border text-accent-foreground'
                                : 'border-border/50 text-muted-foreground hover:border-border')}>
                            {src === 'random' ? '随机数据' : src === 'text' ? '文本输入' : '文件输入'}
                          </button>
                        ))}
                      </div>
                      {inputSource === 'text' && (
                        <textarea value={inputText} onChange={(e) => setInputText(e.target.value)}
                          placeholder="输入推理文本..."
                          className="w-full mt-1.5 h-20 rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:border-ring resize-none" />
                      )}
                    </div>
                  </div>
                </details>
              </div>
```

Key changes:
- Wrap batch/precision/input in `<details>` with a `"更多推理配置"` summary
- The framework selectors stay **outside** the details (always visible)
- The summary has a small `▶` chevron that rotates on open

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/tasks/model_diff/TaskForm.tsx
git commit -m "refactor: collapse batch/precision/input into '更多推理配置' details"
```

---

### Task 5: Three-Column Framework Selector

**Files:**
- Modify: `src/tasks/model_diff/TaskForm.tsx`
- Modify: `src/tasks/model_diff/constants.ts` (if needed — should already have FW_OPTIONS)

**Interfaces:**
- Consumes: `FW_OPTIONS` from `./constants`
- Produces: New framework selection UI — baseline column + 1-2 comparison columns

- [ ] **Step 1: Replace the framework selector section in `TaskForm.tsx`**

Find the current framework selection block (baseline + comparison checkboxes) and replace it with:

```typescript
                  {/* Framework selectors — three columns */}
                  <div className="col-span-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">推理框架</p>
                    <div className="grid grid-cols-3 gap-3">
                      {/* Baseline — always ONNX Runtime, fixed */}
                      <div className="border border-[#1677ff]/20 rounded-lg p-3 bg-[#1677ff]/5">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">基准</div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#1677ff' }} />
                          <span className="text-sm font-semibold">ONNX Runtime</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground/60 mt-1">推理结果作为精度基准</div>
                      </div>

                      {/* Comparison framework 1 — always present */}
                      <div className="border border-[#9333ea]/20 rounded-lg p-3 bg-[#9333ea]/5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">对比框架 1</span>
                        </div>
                        <Select value={comparisonFws[0] || ''} onValueChange={(v) => {
                          setComparisonFws([v])
                          if (baselineFw !== 'onnxruntime') setBaselineFw('onnxruntime')
                        }}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="选择框架" />
                          </SelectTrigger>
                          <SelectContent>
                            {FW_OPTIONS.filter((fw) => fw.value !== 'onnxruntime' && fw.value !== comparisonFws[1]).map((fw) => (
                              <SelectItem key={fw.value} value={fw.value} className="text-xs">
                                <span className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fw.color }} />
                                  {fw.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Comparison framework 2 — optional, shows [+] when empty */}
                      {comparisonFws.length >= 2 ? (
                        <div className="border border-[#f97316]/20 rounded-lg p-3 bg-[#f97316]/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">对比框架 2</span>
                            <button
                              onClick={() => setComparisonFws([comparisonFws[0]])}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >✕</button>
                          </div>
                          <Select value={comparisonFws[1]} onValueChange={(v) => {
                            setComparisonFws([comparisonFws[0], v])
                          }}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FW_OPTIONS.filter((fw) => fw.value !== 'onnxruntime' && fw.value !== comparisonFws[0]).map((fw) => (
                                <SelectItem key={fw.value} value={fw.value} className="text-xs">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fw.color }} />
                                    {fw.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            const remaining = FW_OPTIONS.find((fw) => fw.value !== 'onnxruntime' && fw.value !== comparisonFws[0])
                            if (remaining) setComparisonFws([...comparisonFws, remaining.value])
                          }}
                          className="border border-dashed border-border rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors cursor-pointer"
                        >
                          <span className="text-lg leading-none">+</span>
                          <span className="text-[10px]">添加对比框架 2</span>
                        </button>
                      )}
                    </div>
                  </div>
```

Also move `comparisonFws` in `ModelDiffForm` to initialize as `['tensorrt']` instead of `[]`:

```typescript
const [comparisonFws, setComparisonFws] = useState<string[]>(['tensorrt'])
```

- [ ] **Step 2: Update the run button dynamic text**

Find the button with `开始分析` and update to reflect selected frameworks:

```typescript
              <Button className="w-full h-10 text-sm gap-2"
                disabled={comparisonFws.length === 0} onClick={handleRun}>
                <Layers className="h-4 w-4" />
                {comparisonFws.length > 0
                  ? `开始分析（${comparisonFws.join(' + ')}）`
                  : '请选择对比框架'}
              </Button>
```

- [ ] **Step 3: Update `createTask` call to pass the right frameworks**

The `handleRun` currently does:
```typescript
frameworks: [...new Set([baselineFw, ...comparisonFws])],
```
This is already correct since `baselineFw` is 'onnxruntime' and `comparisonFws` contains the selected comparison frameworks.

- [ ] **Step 4: Remove unused imports and state**

Remove the `baselineFw` state variable and its setter since it's always 'onnxruntime' now. But actually, let's keep it simple and just leave `baselineFw` as-is — it's always 'onnxruntime' and the backend uses it. No need to remove.

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 6: Commit**

```bash
git add src/tasks/model_diff/TaskForm.tsx
git commit -m "feat: three-column framework selector with [+] add button"
```

---

### Task 6: Unified Single Page (Merge HomePage + TaskPage)

**Files:**
- Create: `src/pages/TaskitPage.tsx` — unified page combining upload config + results
- Modify: `src/App.tsx` — update routes to use TaskitPage for both `/` and `/tasks/:id`
- Delete: `src/core/pages/HomePage.tsx` (no longer needed)
- Delete: `src/core/pages/TaskPage.tsx` (no longer needed)

**Interfaces:**
- Consumes: `TaskForm` (config area), `ResultViewer` (results area), `TopNav`, `TaskHistoryDrawer`
- Produces: One component that renders both config and results, switching state via internal `pageState`

- [ ] **Step 1: Create `src/pages/TaskitPage.tsx`**

```typescript
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ModelDiffForm } from '@/tasks/model_diff/TaskForm'
import { ModelDiffResult } from '@/tasks/model_diff/ResultViewer'
import '@/tasks/model_diff'

type PageMode = 'config' | 'result'

export default function TaskitPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [mode, setMode] = useState<PageMode>(idStr ? 'result' : 'config')
  const [activeTaskId, setActiveTaskId] = useState<number | null>(
    idStr ? parseInt(idStr) : null
  )

  // If URL has /tasks/:id, load that task
  useEffect(() => {
    if (idStr) {
      const id = parseInt(idStr)
      if (!isNaN(id)) {
        setActiveTaskId(id)
        setMode('result')
      }
    }
  }, [idStr])

  const handleTaskCreated = useCallback((taskId: number) => {
    setActiveTaskId(taskId)
    setMode('result')
    navigate(`/tasks/${taskId}`, { replace: true })
  }, [navigate])

  const handleNewTask = useCallback(() => {
    setActiveTaskId(null)
    setMode('config')
    navigate('/', { replace: true })
  }, [navigate])

  // Config mode: show file upload + config panel
  if (mode === 'config') {
    return <ModelDiffForm onTaskCreated={handleTaskCreated} />
  }

  // Result mode: show the result viewer for the given task
  if (activeTaskId != null) {
    return (
      <ModelDiffResult
        taskId={activeTaskId}
        onNewTask={handleNewTask}
      />
    )
  }

  return null
}
```

- [ ] **Step 2: Update `src/App.tsx` routes**

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import TaskitPage from '@/pages/TaskitPage'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><TaskitPage /></AuthGuard>} />
        <Route path="/tasks/:id" element={<AuthGuard><TaskitPage /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 3: Delete old page files**

```bash
git rm src/core/pages/HomePage.tsx src/core/pages/TaskPage.tsx
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/TaskitPage.tsx src/App.tsx
git add -A
git commit -m "feat: merge HomePage+TaskPage into single TaskitPage with / and /tasks/:id routes"
```

---

### Task 7: Multi-Column Layer Table

**Files:**
- Modify: `src/tasks/model_diff/LayerTable.tsx`
- Modify: `src/tasks/model_diff/ResultViewer.tsx`

**Interfaces:**
- Consumes: `LayerDiff[]`, list of framework IDs
- Produces: Table with columns for each framework (cosine + max error), sticky layer name column

- [ ] **Step 1: Rewrite `LayerTable.tsx` for multi-column display**

Replace the entire file content with:

```typescript
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { diffToColor } from '@/utils/color'
import { FW_OPTIONS } from './constants'
import type { LayerDiff } from '@/types'

interface Props {
  layers: LayerDiff[]
  frameworkIds: string[]
  loading: boolean
  onSelectLayer: (layer: LayerDiff) => void
  selectedLayerName: string | null
}

export function LayerTable({ layers, frameworkIds, loading, onSelectLayer, selectedLayerName }: Props) {
  const getMetric = (layer: LayerDiff, fwId: string) =>
    layer.metrics.find((m) => m.frameworkId === fwId)

  const sortedLayers = [...layers].sort((a, b) => {
    // Sort by worst cosine across all frameworks
    const aMin = Math.min(...frameworkIds.map((fw) => getMetric(a, fw)?.cosineSimilarity ?? 1))
    const bMin = Math.min(...frameworkIds.map((fw) => getMetric(b, fw)?.cosineSimilarity ?? 1))
    return aMin - bMin
  })

  const fwConfigs = frameworkIds
    .map((id) => FW_OPTIONS.find((o) => o.value === id))
    .filter(Boolean)

  if (loading) {
    return (
      <div className="space-y-1 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-9 bg-muted/50 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-muted overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-muted">
              <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 sticky left-0 bg-card z-10">层名</TableHead>
              <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-16">类型</TableHead>
              {fwConfigs.map((fw) => (
                <TableHead key={fw!.value} className="text-[11px] font-medium h-9 px-3 text-center" style={{ color: fw!.color }} colSpan={2}>
                  <span className="flex items-center gap-1.5 justify-center">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fw!.color }} />
                    {fw!.label}
                    {fw!.value === 'onnxruntime' && <span className="text-[9px] text-muted-foreground font-normal">(基准)</span>}
                  </span>
                </TableHead>
              ))}
            </TableRow>
            <TableRow className="hover:bg-transparent border-muted">
              <TableHead className="text-[11px] font-medium text-muted-foreground h-9 px-3 sticky left-0 bg-card z-10" />
              <TableHead className="text-[11px] font-medium text-muted-foreground h-9 px-3" />
              {fwConfigs.map((fw) => (
                <React.Fragment key={fw!.value}>
                  <TableHead className="text-[10px] text-muted-foreground/60 font-normal h-9 px-1 text-right">余弦相似度</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground/60 font-normal h-9 px-1 text-right">最大误差</TableHead>
                </React.Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLayers.map((layer) => {
              const isSelected = layer.layerName === selectedLayerName
              return (
                <TableRow
                  key={layer.layerName}
                  className={cn(
                    'cursor-pointer border-muted transition-colors',
                    isSelected ? 'bg-accent/80' : 'hover:bg-accent/50'
                  )}
                  onClick={() => onSelectLayer(layer)}
                >
                  <TableCell className="px-3 py-2.5 sticky left-0 bg-card z-10">
                    <span className="text-xs font-medium">{layer.layerName}</span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-muted-foreground/30 text-muted-foreground">
                      {layer.layerType}
                    </Badge>
                  </TableCell>
                  {fwConfigs.map((fw) => {
                    const m = getMetric(layer, fw!.value)
                    const barPct = m ? Math.min(m.cosineSimilarity * 100, 100) : 0
                    const barBg = m ? (m.cosineSimilarity >= 0.99 ? 'bg-pass' : m.cosineSimilarity >= 0.95 ? 'bg-warn' : 'bg-fail') : ''
                    return (
                      <React.Fragment key={fw!.value}>
                        <TableCell className="px-1 py-2.5 text-right">
                          {m ? (
                            <div className="flex items-center gap-1.5 justify-end">
                              <Progress value={barPct} className={cn('h-1 w-12 bg-muted', barBg)} />
                              <span className="font-mono text-xs tabular-nums w-[60px] text-right" style={{ color: diffToColor(m.cosineSimilarity, 0.99) }}>
                                {m.cosineSimilarity.toFixed(4)}
                              </span>
                            </div>
                          ) : <span className="text-xs text-muted-foreground font-mono">—</span>}
                        </TableCell>
                        <TableCell className="px-1 py-2.5 text-right">
                          {m ? (
                            <span className={cn('font-mono text-xs tabular-nums', m.maxAbsError > 0.01 ? 'text-fail' : 'text-muted-foreground')}>
                              {m.maxAbsError.toExponential(4)}
                            </span>
                          ) : '—'}
                        </TableCell>
                      </React.Fragment>
                    )
                  })}
                </TableRow>
              )
            })}
            {sortedLayers.length === 0 && (
              <TableRow>
                <TableCell colSpan={2 + fwConfigs.length * 2} className="text-center text-muted-foreground py-10 text-xs">
                  暂无层数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

import React from 'react'
```

- [ ] **Step 2: Update `ResultViewer.tsx` to pass `frameworkIds` to LayerTable**

Find the `<LayerTable>` usage and update:

```typescript
            <LayerTable
              layers={layers}
              frameworkIds={task?.frameworks ?? []}
              loading={layersLoading}
              onSelectLayer={(l) => setSelectedLayer(l.layerName)}
              selectedLayerName={selectedLayer}
            />
```

Also remove the framework selector dropdown from the top of the results page since columns now show all frameworks.

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 4: Commit**

```bash
git add src/tasks/model_diff/LayerTable.tsx src/tasks/model_diff/ResultViewer.tsx
git commit -m "feat: multi-column layer table showing all frameworks side by side"
```

---

### Task 8: Floating Layer Detail Tooltip

**Files:**
- Create: `src/tasks/model_diff/LayerTooltip.tsx` — floating tooltip component
- Modify: `src/tasks/model_diff/ResultViewer.tsx` — replace right panel with tooltip

**Interfaces:**
- Consumes: `LayerDiff`, `FW_OPTIONS` from constants
- Produces: Positioned tooltip near the clicked row

- [ ] **Step 1: Create `src/tasks/model_diff/LayerTooltip.tsx`**

```typescript
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { FW_OPTIONS } from './constants'
import type { LayerDiff } from '@/types'

interface Props {
  layer: LayerDiff
  onClose: () => void
}

export function LayerTooltip({ layer, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Close on Escape
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  return (
    <>
      {/* Backdrop for click-outside */}
      <div className="fixed inset-0 z-40" />
      <div
        ref={ref}
        className="fixed z-50 w-[360px] rounded-xl border border-border bg-card shadow-xl animate-in fade-in zoom-in-95"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm font-semibold truncate">{layer.layerName}</span>
            <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30 shrink-0">
              {layer.layerType}
            </Badge>
          </div>
          <button className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={onClose}>✕</button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Shape info */}
          <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded-md p-2.5">
            输入 [{layer.inputShape.join(', ')}] → 输出 [{layer.outputShape.join(', ')}]
          </div>

          {/* Per-framework metrics */}
          {layer.metrics.map((m) => {
            const cfg = FW_OPTIONS.find((o) => o.value === m.frameworkId)
            return (
              <div key={m.frameworkId}>
                <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: cfg?.color }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg?.color }} />
                  {cfg?.label}
                  {m.frameworkId === 'onnxruntime' && <span className="text-[10px] text-muted-foreground font-normal">(基准)</span>}
                </h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: 'cosineSimilarity', label: '余弦相似度', val: m.cosineSimilarity },
                    { key: 'maxAbsError', label: '最大绝对误差', val: m.maxAbsError },
                    { key: 'meanAbsError', label: '平均绝对误差', val: m.meanAbsError },
                    { key: 'snr', label: '信噪比', val: m.snr, unit: 'dB' },
                  ].map((item) => {
                    const val = item.val as number
                    const isHigherBetter = item.key === 'cosineSimilarity' || item.key === 'snr'
                    const threshold = item.key === 'cosineSimilarity' ? 0.99
                      : item.key === 'snr' ? 20
                      : item.key === 'maxAbsError' ? 0.01
                      : 0.005
                    const passed = isHigherBetter ? val >= threshold : val <= threshold
                    return (
                      <div key={item.key}
                        className={cn('p-2 rounded-md border text-xs',
                          passed ? 'border-pass/20 bg-pass/5' : 'border-fail/20 bg-fail/5')}>
                        <div className="text-muted-foreground text-[10px] mb-0.5">{item.label}</div>
                        <span className="font-mono text-sm font-bold tabular-nums"
                          style={{ color: passed ? '#22c55e' : '#ef4444' }}>
                          {item.key === 'cosineSimilarity' ? val.toFixed(6) : val.toExponential(4)}
                          {item.unit && <span className="text-muted-foreground text-[10px] font-normal ml-0.5">{item.unit}</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Replace right panel in `ResultViewer.tsx`**

Remove the right panel section (the `selectedLayerData && <div className="w-[380px] shrink-0...>` block) and replace with:

```typescript
      {/* Floating layer tooltip */}
      {selectedLayerData && (
        <LayerTooltip
          layer={selectedLayerData}
          onClose={() => setSelectedLayer(null)}
        />
      )}
```

Also remove the `pr-0` class from the main content area container.

Add import at the top:

```typescript
import { LayerTooltip } from './LayerTooltip'
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 4: Commit**

```bash
git add src/tasks/model_diff/LayerTooltip.tsx src/tasks/model_diff/ResultViewer.tsx
git commit -m "feat: replace right panel with floating layer tooltip"
```

---

### Task 9: Integrate Toast into TaskForm

**Files:**
- Modify: `src/tasks/model_diff/TaskForm.tsx`
- Modify: `src/api/mock/handlers.ts` (optional — if we want toast on mock create)

**Interfaces:**
- Consumes: `useToast` from `@/components/ui/toast`
- Produces: Toast notifications at key lifecycle points

- [ ] **Step 1: Add toast calls in `TaskForm.tsx`**

Import `useToast` at the top:

```typescript
import { useToast } from '@/components/ui/toast'
```

Inside the component function:

```typescript
const { toast } = useToast()
```

Add toast on task creation failure (in the `catch` block around line 119):

```typescript
    } catch {
      setBoxState('config')
      setRunning(false)
      toast({
        title: '分析启动失败',
        description: '请检查网络连接后重试',
        variant: 'destructive',
      })
    }
```

Add toast on task completion (after `clearInterval(poll)` in the polling block):

```typescript
          if (updated.status === 'completed') {
            clearInterval(poll)
            setRunning(false)
            toast({ title: '分析完成', description: `任务 #${t.id} 已完成` })
            onTaskCreated(t.id)
          }
```

Add toast on task failure:

```typescript
          if (updated.status === 'failed') {
            clearInterval(poll)
            setRunning(false)
            toast({
              title: '分析失败',
              description: updated.error || '未知错误',
              variant: 'destructive',
            })
          }
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -v "vitest\|__tests__" || echo "OK"
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/tasks/model_diff/TaskForm.tsx
git commit -m "feat: add toast notifications for task lifecycle events"
```

---

## Spec Coverage Check

| Spec Item | Task |
|-----------|------|
| 1. 单页布局（合并 HomePage + TaskPage） | Task 6 ✓ |
| 2. 框架三列选择器 | Task 5 ✓ |
| 3. "更多推理配置"折叠 | Task 4 ✓ |
| 4. 多列表格 | Task 7 ✓ |
| 5. 层详情悬浮小窗 | Task 8 ✓ |
| 6. URL 设计 `/` + `/tasks/:id` | Task 6 ✓ |
| 7. Toast 通知 | Task 1 + Task 9 ✓ |
| 8. 轮询生命周期修复 | Task 2 ✓ |
| 9. Mock 数据补全 graphData | Task 3 ✓ |
| 10. 默认主题亮色 + 持久化 | (已完成) |
