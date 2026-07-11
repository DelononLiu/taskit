# Legacy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete dead code (957-line Tool page), migrate TaskDetail components into tasks/model_diff/, extract shared FW_OPTIONS constants, and extend test coverage.

**Architecture:** Four sequential tasks, each with independent commit. Tasks 1-3 clean up old architecture remnants; Task 4 adds test coverage for key components. No behavior changes.

**Tech Stack:** React 18, TypeScript, Vite 5, Vitest, @testing-library/react

## Global Constraints

- All existing code patterns must be followed (Tailwind classes, import style, component patterns)
- No unrelated refactoring — only what's listed in each task
- Formatting: Follow file's existing style (Prettier not configured)
- Every task ends with `npx tsc --noEmit` pass and a git commit

---

### Task 1: Delete `src/pages/Tool/index.tsx` (dead code)

**Files:**
- Delete: `src/pages/Tool/index.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: clean deletion — `App.tsx`, `main.tsx`, and all other files already have zero references to this file

- [ ] **Step 1: Verify no active references**

```bash
grep -r "Tool" src/ --include="*.ts" --include="*.tsx" --include="*.json" | grep -v "Toolbar\|Tooltip\|\.tool\|tool-" | grep -v node_modules | grep -v "ModelDiff"
```

Expected: no references to `import Tool` or `from '@/pages/Tool'`.

- [ ] **Step 2: Delete the file**

```bash
git rm src/pages/Tool/index.tsx
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove dead Tool/index.tsx (957 lines, replaced by modular core/tasks)"
```

---

### Task 2: Migrate OverviewChart + LayerTable into `tasks/model_diff/` and delete old `pages/TaskDetail/`

**Files:**
- Create: `src/tasks/model_diff/OverviewChart.tsx`
- Create: `src/tasks/model_diff/LayerTable.tsx`
- Modify: `src/tasks/model_diff/ResultViewer.tsx` (lines 10-11, update imports)
- Delete: `src/pages/TaskDetail/` (entire directory)

**Interfaces:**
- Consumes: `ResultViewer.tsx` currently imports `OverviewChart` and `LayerTable` from `@/pages/TaskDetail/`
- Produces: All imports redirect to `@/tasks/model_diff/`; old directory removed

- [ ] **Step 1: Create `src/tasks/model_diff/OverviewChart.tsx`**

Flatten the existing 2-file directory into a single component file.

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip,
} from 'recharts'
import type { FrameworkResult } from '@/types'
import { getFrameworkColor } from '@/utils/color'

interface Props {
  comparisons: FrameworkResult[]
}

const chartTheme = {
  text: '#a1a1aa',
  grid: '#27272a',
}

export function OverviewChart({ comparisons }: Props) {
  const radarData = [
    {
      metric: '余弦相似度',
      ...Object.fromEntries(
        comparisons.map((c) => [c.framework.name, c.overallMetrics.avgCosineSimilarity])
      ),
    },
    {
      metric: '通过率',
      ...Object.fromEntries(
        comparisons.map((c) => [
          c.framework.name,
          c.overallMetrics.totalLayers > 0
            ? c.overallMetrics.passedLayers / c.overallMetrics.totalLayers
            : 0,
        ])
      ),
    },
  ]

  if (comparisons.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-3">
      <Card className="border-muted">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">精度维度雷达图</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-2 pb-2">
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={chartTheme.grid} />
              <PolarAngleAxis dataKey="metric" fontSize={11} tick={{ fill: chartTheme.text }} />
              <PolarRadiusAxis angle={30} domain={[0.9, 1]} fontSize={10} tick={{ fill: chartTheme.text }} />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 6, fontSize: 12 }}
              />
              {comparisons.map((c) => (
                <Radar
                  key={c.framework.id}
                  name={c.framework.name}
                  dataKey={c.framework.name}
                  stroke={getFrameworkColor(c.framework.id)}
                  fill={getFrameworkColor(c.framework.id)}
                  fillOpacity={0.15}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/tasks/model_diff/LayerTable.tsx`**

Direct copy from old path, single component file.

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
import type { LayerDiff } from '@/types'

interface Props {
  layers: LayerDiff[]
  frameworkId: string
  loading: boolean
  onSelectLayer: (layer: LayerDiff) => void
  selectedLayerName: string | null
}

export function LayerTable({ layers, frameworkId, loading, onSelectLayer, selectedLayerName }: Props) {
  const getMetric = (layer: LayerDiff) =>
    layer.metrics.find((m) => m.frameworkId === frameworkId)

  const sortedLayers = [...layers].sort((a, b) => {
    const ma = getMetric(a)
    const mb = getMetric(b)
    return (ma?.cosineSimilarity ?? 0) - (mb?.cosineSimilarity ?? 0)
  })

  const barColor = (val: number) => {
    if (val >= 0.99) return 'bg-pass'
    if (val >= 0.95) return 'bg-warn'
    return 'bg-fail'
  }

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
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-muted">
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3">层名</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-16">类型</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3">余弦相似度</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-28 text-right">最大误差</TableHead>
            <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider h-9 px-3 w-16 text-center">结果</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedLayers.map((layer) => {
            const m = getMetric(layer)
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
                <TableCell className="px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium truncate">{layer.layerName}</span>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-muted-foreground/30 text-muted-foreground">
                    {layer.layerType}
                  </Badge>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {m ? (
                    <div className="flex items-center gap-2.5">
                      <Progress
                        value={m.cosineSimilarity * 100}
                        className={cn('h-1.5 flex-1 max-w-[100px] bg-muted', barColor(m.cosineSimilarity))}
                      />
                      <span
                        className="font-mono text-xs tabular-nums w-[68px] text-right shrink-0"
                        style={{ color: diffToColor(m.cosineSimilarity, 0.99) }}
                      >
                        {m.cosineSimilarity.toFixed(6)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground font-mono">—</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-right">
                  {m ? (
                    <span className={cn(
                      'font-mono text-xs tabular-nums',
                      m.maxAbsError > 0.01 ? 'text-fail' : 'text-muted-foreground'
                    )}>
                      {m.maxAbsError.toExponential(4)}
                    </span>
                  ) : '—'}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-center">
                  {m ? (
                    m.passed
                      ? <Badge variant="success" className="text-[10px] h-5 px-1.5">通过</Badge>
                      : <Badge variant="destructive" className="text-[10px] h-5 px-1.5">失败</Badge>
                  ) : '—'}
                </TableCell>
              </TableRow>
            )
          })}
          {sortedLayers.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-10 text-xs">
                暂无层数据
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 3: Update `ResultViewer.tsx` imports**

In `src/tasks/model_diff/ResultViewer.tsx`, replace lines 10-11:

```typescript
import { OverviewChart } from '@/pages/TaskDetail/OverviewChart'
import { LayerTable } from '@/pages/TaskDetail/LayerTable'
```

→

```typescript
import { OverviewChart } from './OverviewChart'
import { LayerTable } from './LayerTable'
```

- [ ] **Step 4: Delete the old directory**

```bash
rm -rf src/pages/TaskDetail
```

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/model_diff/OverviewChart.tsx src/tasks/model_diff/LayerTable.tsx src/tasks/model_diff/ResultViewer.tsx
git add -A  # catches deletions
git commit -m "chore: migrate OverviewChart/LayerTable into tasks/model_diff, remove old pages/TaskDetail"
```

---

### Task 3: Extract `FW_OPTIONS` to shared constants

**Files:**
- Create: `src/tasks/model_diff/constants.ts`
- Modify: `src/tasks/model_diff/TaskForm.tsx` (replace inline FW_OPTIONS with import)
- Modify: `src/tasks/model_diff/ResultViewer.tsx` (replace inline FW_OPTIONS with import)

**Interfaces:**
- Consumes: Both TaskForm and ResultViewer had identical `FW_OPTIONS` arrays defined inline
- Produces: Shared `constants.ts` consumed by both components

- [ ] **Step 1: Create `src/tasks/model_diff/constants.ts`**

```typescript
export const FW_OPTIONS = [
  { value: 'onnxruntime', label: 'ONNX Runtime', color: '#1677ff' },
  { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
  { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
]
```

- [ ] **Step 2: Update `TaskForm.tsx` — remove inline `FW_OPTIONS`, add import**

In `src/tasks/model_diff/TaskForm.tsx`, delete lines 19-23:

```typescript
const FW_OPTIONS = [
  { value: 'onnxruntime', label: 'ONNX Runtime', color: '#1677ff' },
  { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
  { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
]
```

Then add an import at the top of the file (after line 16 or in the existing import block):

```typescript
import { FW_OPTIONS } from './constants'
```

- [ ] **Step 3: Update `ResultViewer.tsx` — remove inline `FW_OPTIONS`, add import**

In `src/tasks/model_diff/ResultViewer.tsx`, delete lines 24-28:

```typescript
const FW_OPTIONS = [
  { value: 'onnxruntime', label: 'ONNX Runtime', color: '#1677ff' },
  { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
  { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
]
```

Add import at the top:

```typescript
import { FW_OPTIONS } from './constants'
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/model_diff/constants.ts src/tasks/model_diff/TaskForm.tsx src/tasks/model_diff/ResultViewer.tsx
git commit -m "refactor: extract FW_OPTIONS to shared constants.ts"
```

---

### Task 4: Extend test coverage

**Files:**
- Modify: `package.json` (if @testing-library/react not yet installed)
- Create: `src/components/__tests__/ErrorBoundary.test.tsx`
- Create: `src/api/__tests__/task.test.ts`

**Interfaces:**
- Consumes: `ErrorBoundary` component from `src/components/ErrorBoundary.tsx`, mock handlers from `src/api/mock/handlers.ts`
- Produces: 2 new test files covering ErrorBoundary rendering/error states and mock API task lifecycle

- [ ] **Step 1: Check @testing-library/react**

```bash
node -e "require('@testing-library/react')" 2>&1 || echo "MISSING"
```

If "MISSING", install:

```bash
npm install -D @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Create `src/components/__tests__/ErrorBoundary.test.tsx`**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

afterEach(cleanup)

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>hello world</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('hello world')).toBeDefined()
  })

  it('catches errors and shows fallback UI', () => {
    // Suppress console.error from React's error logging
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Broken = () => { throw new Error('test crash') }

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    )

    expect(screen.getByText('应用出现异常')).toBeDefined()
    expect(screen.getByText('test crash')).toBeDefined()
    expect(screen.getByText('重试')).toBeDefined()
    expect(screen.getByText('刷新页面')).toBeDefined()

    spy.mockRestore()
  })

  it('shows custom fallback when provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Broken = () => { throw new Error('custom') }

    render(
      <ErrorBoundary fallback={<div>Custom Error UI</div>}>
        <Broken />
      </ErrorBoundary>
    )

    expect(screen.getByText('Custom Error UI')).toBeDefined()

    spy.mockRestore()
  })
})
```

- [ ] **Step 3: Create `src/api/__tests__/task.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mockApi } from '@/api/mock/handlers'

describe('mockApi.createTask', () => {
  it('returns a running task with correct frameworks', async () => {
    const task = await mockApi.createTask({
      modelId: 'model-1',
      frameworks: ['onnxruntime', 'tensorrt'],
    })
    expect(task.id).toBeGreaterThan(0)
    expect(task.frameworks).toEqual(['onnxruntime', 'tensorrt'])
    expect(task.status).toBe('running')
    expect(task.progress).toBe(0)
  })
})

describe('mockApi.getTask', () => {
  it('returns a completed task for ID 1', async () => {
    const task = await mockApi.getTask(1)
    expect(task.status).toBe('completed')
  })

  it('returns failed task with error message for ID 3', async () => {
    const task = await mockApi.getTask(3)
    expect(task.status).toBe('failed')
    expect(task.error).toContain('推理失败')
    expect(task.progress).toBe(62)
  })

  it('returns running task for a new ID', async () => {
    const task = await mockApi.getTask(999)
    expect(['running', 'completed']).toContain(task.status)
    expect(task.id).toBe(999)
  })
})

describe('mockApi.uploadModel', () => {
  it('calls onProgress callback', async () => {
    const onProgress = vi.fn()
    const result = await mockApi.uploadModel(new File([], 'test.onnx'), onProgress)
    expect(onProgress).toHaveBeenCalled()
    expect(result.name).toBe('test.onnx')
    expect(result.format).toBe('onnx')
  })
})
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass (color.test.ts + metric.test.ts + ErrorBoundary + task mock tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/__tests__/ src/api/__tests__/ package.json
git commit -m "test: add ErrorBoundary and mock API tests"
```

---

## Spec Coverage Check

| Spec Item | Task |
|-----------|------|
| Delete `src/pages/Tool/index.tsx` | Task 1 ✓ |
| Migrate OverviewChart/LayerTable → `tasks/model_diff/` | Task 2 ✓ |
| Delete `src/pages/TaskDetail/` directory | Task 2 ✓ |
| Extract `FW_OPTIONS` to shared `constants.ts` | Task 3 ✓ |
| Test coverage: ErrorBoundary component tests | Task 4 ✓ |
| Test coverage: mock API task lifecycle tests | Task 4 ✓ |
