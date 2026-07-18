import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TaskTable } from '@/core/components/TaskTable'
import type { ComparisonTask } from '@/types'

afterEach(cleanup)

// Helper: create a minimal ComparisonTask fixture
function createTask(overrides: Partial<ComparisonTask> & { id: number }): ComparisonTask {
  return {
    model: { id: 'm1', name: 'resnet50', format: 'onnx', size: 1024, uploadTime: '2025-01-01T00:00:00Z' },
    frameworks: ['onnxruntime', 'openvino'],
    status: 'pending',
    progress: 0,
    createdAt: '2025-01-01T00:00:00Z',
    completedAt: undefined,
    error: undefined,
    baseline: null,
    comparisons: [],
    ...overrides,
  }
}

const mockTasks: ComparisonTask[] = [
  createTask({
    id: 1,
    model: { id: 'm1', name: 'resnet50', format: 'onnx', size: 1024, uploadTime: '2025-01-01T00:00:00Z' },
    frameworks: ['onnxruntime', 'openvino'],
    status: 'completed',
    completedAt: '2025-01-02T00:00:00Z',
    comparisons: [
      {
        framework: { id: 'onnxruntime', name: 'ONNX Runtime', value: 'onnxruntime' },
        overallMetrics: {
          avgCosineSimilarity: 0.9987,
          maxAbsError: 0.000123,
          totalLayers: 50,
          passedLayers: 48,
          failedLayers: 2,
          worstLayer: 'conv1',
        },
      },
    ],
  }),
  createTask({
    id: 2,
    model: { id: 'm2', name: 'bert-base', format: 'onnx', size: 2048, uploadTime: '2025-01-03T00:00:00Z' },
    frameworks: ['transformers'],
    status: 'running',
    createdAt: '2025-01-03T00:00:00Z',
  }),
  createTask({
    id: 3,
    model: { id: 'm3', name: 'yolov8', format: 'onnx', size: 4096, uploadTime: '2025-01-04T00:00:00Z' },
    frameworks: ['openvino', 'onnxruntime'],
    status: 'failed',
    completedAt: '2025-01-05T00:00:00Z',
  }),
  createTask({
    id: 4,
    model: { id: 'm4', name: 'gpt2', format: 'onnx', size: 512, uploadTime: '2025-01-06T00:00:00Z' },
    frameworks: ['torch-cpu', 'onnxruntime'],
    status: 'pending',
  }),
]

describe('TaskTable', () => {
  // ── 1. Empty state ─────────────────────────────────────────────────
  describe('empty state', () => {
    it('renders EmptyState with title, description and action button when there are no tasks', () => {
      const onNewTask = vi.fn()
      const onSelectTask = vi.fn()
      render(
        <TaskTable
          tasks={[]}
          onSelectTask={onSelectTask}
          onNewTask={onNewTask}
        />,
      )

      // EmptyState renders the specific title
      expect(screen.getByText('尚未创建比对任务')).toBeDefined()

      // Description text is rendered
      expect(screen.getByText('上传 .onnx 模型文件并选择目标框架，开始分析精度差异')).toBeDefined()

      // Action button with the expected label
      const btn = screen.getByText('新建比对任务')
      expect(btn).toBeDefined()

      // Click triggers onNewTask
      fireEvent.click(btn)
      expect(onNewTask).toHaveBeenCalledTimes(1)
    })

    it('does NOT show EmptyState when loading is true even if tasks array is empty', () => {
      render(
        <TaskTable
          tasks={[]}
          loading={true}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Empty state text should not appear — instead the loading indicator is shown
      expect(screen.queryByText('尚未创建比对任务')).toBeNull()
      expect(screen.getByText('加载中...')).toBeDefined()
    })
  })

  // ── 2. Loading state ──────────────────────────────────────────────
  describe('loading state', () => {
    it('shows "加载中..." row when loading is true', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          loading={true}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Loading indicator is present
      expect(screen.getByText('加载中...')).toBeDefined()

      // Task rows are NOT rendered during loading (the tbody renders loading OR filtered rows)
      expect(screen.queryByText('resnet50')).toBeNull()
    })
  })

  // ── 3. Filtered empty ─────────────────────────────────────────────
  describe('filtered empty state', () => {
    it('shows "无匹配任务" when tasks exist but none match the filter', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          filterStatus="cancelled"
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      expect(screen.getByText('无匹配任务')).toBeDefined()
    })
  })

  // ── 4. Table rendering ────────────────────────────────────────────
  describe('table rendering', () => {
    it('renders model names, framework tags, and StatusBadge for each task', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // All model names are displayed
      expect(screen.getByText('resnet50')).toBeDefined()
      expect(screen.getByText('bert-base')).toBeDefined()
      expect(screen.getByText('yolov8')).toBeDefined()
      expect(screen.getByText('gpt2')).toBeDefined()

      // Framework tags are rendered (onnxruntime appears in 3 tasks, openvino in 2)
      const onnxruntimeTags = screen.getAllByText('onnxruntime')
      expect(onnxruntimeTags.length).toBe(3)
      const openvinoTags = screen.getAllByText('openvino')
      expect(openvinoTags.length).toBe(2)
      expect(screen.getByText('transformers')).toBeDefined()
      expect(screen.getByText('torch-cpu')).toBeDefined()

      // StatusBadge labels are rendered (each also appears as a <select> option)
      expect(screen.getAllByText('READY').length).toBe(2)
      expect(screen.getAllByText('COMPILING').length).toBe(2)
      expect(screen.getAllByText('FAILED').length).toBe(2)
      expect(screen.getAllByText('PENDING').length).toBe(2)
    })

    it('renders accuracy metrics for completed tasks', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Completed task resnet50 has metrics
      expect(screen.getByText('0.9987')).toBeDefined()
      expect(screen.getByText('0.000123')).toBeDefined()
    })

    it('renders "—" for non-completed tasks in metrics column', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Find all — indicators (one per non-completed task row in metrics column)
      // bert-base (running), yolov8 (failed), gpt2 (pending) each have a — in the metrics cell
      const dashes = screen.getAllByText('—')
      // There should be at least 3 (one per non-completed task in the metrics column)
      expect(dashes.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ── 5. Status filter ──────────────────────────────────────────────
  describe('status filter', () => {
    it('filters the table when a status is selected via controlled props', () => {
      const onFilterChange = vi.fn()
      const { rerender } = render(
        <TaskTable
          tasks={mockTasks}
          filterStatus=""
          onFilterStatusChange={onFilterChange}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // All 4 tasks visible initially
      expect(screen.getByText('resnet50')).toBeDefined()
      expect(screen.getByText('gpt2')).toBeDefined()

      // Select "completed" filter
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'completed' } })
      expect(onFilterChange).toHaveBeenCalledWith('completed')

      // Re-render with filter applied
      rerender(
        <TaskTable
          tasks={mockTasks}
          filterStatus="completed"
          onFilterStatusChange={onFilterChange}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Only completed task (resnet50) should show
      expect(screen.getByText('resnet50')).toBeDefined()
      expect(screen.queryByText('bert-base')).toBeNull()
      expect(screen.queryByText('yolov8')).toBeNull()
      expect(screen.queryByText('gpt2')).toBeNull()
    })

    it('uses local state for filter when no controlled props given', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Initially all 4 tasks visible
      expect(screen.getByText('resnet50')).toBeDefined()
      expect(screen.getByText('gpt2')).toBeDefined()

      // Select "failed"
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'failed' } })

      // Only failed task (yolov8) should remain
      expect(screen.getByText('yolov8')).toBeDefined()
      expect(screen.queryByText('resnet50')).toBeNull()
      expect(screen.queryByText('bert-base')).toBeNull()
      expect(screen.queryByText('gpt2')).toBeNull()
    })
  })

  // ── 6. Search ─────────────────────────────────────────────────────
  describe('search', () => {
    it('filters tasks by model name when typing in search box (controlled)', () => {
      const onSearchChange = vi.fn()
      const { rerender } = render(
        <TaskTable
          tasks={mockTasks}
          searchQuery=""
          onSearchChange={onSearchChange}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // All tasks visible initially
      expect(screen.getByText('resnet50')).toBeDefined()

      // Type in search box
      const input = screen.getByPlaceholderText('搜索模型名称...')
      fireEvent.change(input, { target: { value: 'bert' } })
      expect(onSearchChange).toHaveBeenCalledWith('bert')

      // Re-render with search applied
      rerender(
        <TaskTable
          tasks={mockTasks}
          searchQuery="bert"
          onSearchChange={onSearchChange}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // Only bert-base should show
      expect(screen.getByText('bert-base')).toBeDefined()
      expect(screen.queryByText('resnet50')).toBeNull()
      expect(screen.queryByText('yolov8')).toBeNull()
      expect(screen.queryByText('gpt2')).toBeNull()
    })

    it('uses local state for search when no controlled props given', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      // All tasks visible initially
      expect(screen.getByText('resnet50')).toBeDefined()
      expect(screen.getByText('gpt2')).toBeDefined()

      // Type in search box
      const input = screen.getByPlaceholderText('搜索模型名称...')
      fireEvent.change(input, { target: { value: 'yolo' } })

      // Only yolov8 should remain
      expect(screen.getByText('yolov8')).toBeDefined()
      expect(screen.queryByText('resnet50')).toBeNull()
      expect(screen.queryByText('bert-base')).toBeNull()
      expect(screen.queryByText('gpt2')).toBeNull()
    })

    it('search is case-insensitive', () => {
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={vi.fn()}
          onNewTask={vi.fn()}
        />,
      )

      const input = screen.getByPlaceholderText('搜索模型名称...')
      fireEvent.change(input, { target: { value: 'RESNET' } })

      expect(screen.getByText('resnet50')).toBeDefined()
      expect(screen.queryByText('bert-base')).toBeNull()
    })
  })

  // ── 7. Row click ──────────────────────────────────────────────────
  describe('row click', () => {
    it('calls onSelectTask with the task when a row body is clicked', () => {
      const onSelectTask = vi.fn()
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={onSelectTask}
          onNewTask={vi.fn()}
        />,
      )

      // Click on the resnet50 row — use a cell that isn't the action button
      const row = screen.getByText('resnet50').closest('tr')!
      fireEvent.click(row)

      expect(onSelectTask).toHaveBeenCalledTimes(1)
      expect(onSelectTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, model: expect.objectContaining({ name: 'resnet50' }) }),
      )
    })

    it('calls onSelectTask when the action icon button is clicked', () => {
      const onSelectTask = vi.fn()
      render(
        <TaskTable
          tasks={mockTasks}
          onSelectTask={onSelectTask}
          onNewTask={vi.fn()}
        />,
      )

      // Click the action icon button for resnet50
      const detailButtons = screen.getAllByTitle('查看详情')
      fireEvent.click(detailButtons[0])

      expect(onSelectTask).toHaveBeenCalledTimes(1)
      expect(onSelectTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
      )
    })

    it('does not propagate row click when action button is clicked', () => {
      const onSelectTask = vi.fn()
      render(
        <TaskTable
          tasks={[mockTasks[0]]}
          onSelectTask={onSelectTask}
          onNewTask={vi.fn()}
        />,
      )

      const detailBtn = screen.getByTitle('查看详情')
      fireEvent.click(detailBtn)

      // Should be called exactly once (by the button, not propagated from the row)
      expect(onSelectTask).toHaveBeenCalledTimes(1)
    })
  })

  // ── 8. New task button in empty state ─────────────────────────────
  describe('new task button', () => {
    it('clicking the action button in EmptyState calls onNewTask', () => {
      const onNewTask = vi.fn()
      render(
        <TaskTable
          tasks={[]}
          onSelectTask={vi.fn()}
          onNewTask={onNewTask}
        />,
      )

      fireEvent.click(screen.getByText('新建比对任务'))
      expect(onNewTask).toHaveBeenCalledTimes(1)
    })
  })
})
