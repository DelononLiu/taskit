import { useState, useEffect } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getTask, getTaskLayers } from '@/api/task'
import { OverviewChart } from './OverviewChart'
import { LayerTable } from './LayerTable'
import { ExecutionTree } from './ExecutionTree'
import { LayerTooltip } from './LayerTooltip'
import type { ComparisonTask, LayerDiff, LayerMetric, GraphData } from '@/types'
import { formatSize, extractArch, mockParams } from './utils'
import { MOCK_TASK_IDS, MOCK_LAYERS_ALL_PASS, MOCK_LAYERS_HAS_FAIL, buildMockTask } from './mockData'
import { TaskHistoryDrawer } from '@/core/components/TaskHistoryDrawer'
import { TopNav } from '@/core/components/TopNav'
import { FW_OPTIONS } from './constants'
import { USE_MOCK } from '@/lib/env'

interface Props {
  taskId: number
  onNewTask: () => void
}

export function ModelCompareResult({ taskId, onNewTask }: Props) {
  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [layers, setLayers] = useState<LayerDiff[]>([])
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [layersLoading, setLayersLoading] = useState(true)
  const [selectedFramework, setSelectedFramework] = useState('tensorrt')
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const selectedLayerData = layers.find((l) => l.layerName === selectedLayer) ?? null

  useEffect(() => {
    if (USE_MOCK) {
      if (taskId === MOCK_TASK_IDS.RESNET50) {
        setTask(buildMockTask(MOCK_TASK_IDS.RESNET50, 'resnet50_v1', 'completed', 3, 3))
        setLayers(MOCK_LAYERS_ALL_PASS)
        setSelectedLayer(null)
        setSelectedFramework('onnxruntime')
      } else if (taskId === MOCK_TASK_IDS.YOLOV8) {
        setTask(buildMockTask(MOCK_TASK_IDS.YOLOV8, 'yolov8_test', 'completed', 2, 3))
        setLayers(MOCK_LAYERS_HAS_FAIL)
        setSelectedLayer('conv_23')
        setSelectedFramework('onnxruntime')
      } else {
        setTask(buildMockTask(MOCK_TASK_IDS.BERT, 'bert_base_eval', 'failed', 0, 0))
        setLayers([])
        setSelectedLayer(null)
        setSelectedFramework('onnxruntime')
      }
      setLayersLoading(false)
      return
    }

    loadRealTask(taskId)
  }, [taskId])

  async function loadRealTask(tid: number) {
    try {
      const t = await getTask(tid)
      setTask(t)
      const { layers: rawLayers, graph: g } = await getTaskLayers(tid)
      setLayers(rawLayers)
      setGraphData(g)
      // Auto-select first framework that has metrics data
      const fwSet = new Set<string>()
      rawLayers.forEach((l: LayerDiff) => l.metrics?.forEach((m: LayerMetric) => fwSet.add(m.frameworkId)))
      const firstFw = [...fwSet][0]
      if (firstFw) setSelectedFramework(firstFw)
      const failed = rawLayers.find((l: any) => l.metrics?.some((m: any) => !m.passed))
      setSelectedLayer(failed?.layerName ?? null)
    } catch (e) {
      console.error('load task failed', e)
    } finally {
      setLayersLoading(false)
    }
  }

  if (!task) return null

  return (
    <div className="h-screen flex flex-col">
      <TopNav
        title={`#${task.id}`}
        subtitle={task.model?.name}
        showNewTask
        onNewTask={onNewTask}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <div className="flex-1 flex min-h-0 bg-muted/30">
        <div className={'flex-1 min-w-0 overflow-y-auto p-5 space-y-4'}>

          {/* Model Info */}
          {task && (
            <div className="rounded-lg border border-muted bg-card">
              <div className="px-3.5 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-muted">模型信息</div>
              <div className="grid grid-cols-5 divide-x divide-muted text-[11px]">
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">架构</p>
                  <p className="font-medium text-foreground">{extractArch(task.model?.name ?? '')}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">参数量</p>
                  <p className="font-medium text-foreground">{mockParams(task.model?.name ?? '')}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">框架</p>
                  <p className="font-mono text-foreground">{(task.frameworks ?? []).join(' + ')}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">硬件</p>
                  <p className="font-medium text-foreground">NVIDIA CUDA 12.1</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-muted-foreground/60 mb-0.5">文件</p>
                  <p className="font-mono text-xs text-foreground">{task.model?.name ?? '—'}</p>
                  <p className="text-muted-foreground/60">{task.model ? formatSize(task.model.size) : ''}</p>
                </div>
              </div>
            </div>
          )}

          {/* Layer Cosine + Radar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-muted bg-card">
              <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-muted flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                层输出余弦（倒序）
              </div>
              <div className="px-3 py-2 space-y-0.5">
                {layers.length === 0 && <p className="text-[11px] text-muted-foreground/60 py-1">无数据</p>}
                {[...layers]
                  .sort((a, b) => {
                    const aMin = Math.min(...a.metrics.map((m: LayerMetric) => m.cosineSimilarity))
                    const bMin = Math.min(...b.metrics.map((m: LayerMetric) => m.cosineSimilarity))
                    return aMin - bMin
                  })
                  .map((l) => {
                    // Show the worst metric across all frameworks
                    const worst = l.metrics.reduce((worst: LayerMetric | null, m: LayerMetric) =>
                      !worst || m.cosineSimilarity < worst.cosineSimilarity ? m : worst, null as LayerMetric | null)
                    if (!worst) return null
                    return (
                      <button key={l.layerName} onClick={() => setSelectedLayer(l.layerName)}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md transition-colors text-left',
                          selectedLayer === l.layerName ? 'bg-accent' : 'hover:bg-accent/50'
                        )}>
                        <span className="text-[11px] font-mono text-muted-foreground truncate">{l.layerName}</span>
                        <span className={cn('font-mono text-xs font-bold tabular-nums shrink-0', worst.passed ? 'text-pass' : 'text-fail')}>
                          {worst.cosineSimilarity.toFixed(4)}
                        </span>
                      </button>
                    )
                  })}
              </div>
            </div>

            {/* Radar Chart */}
            {task.comparisons && task.comparisons.length > 0 && (
              <OverviewChart comparisons={task.comparisons} />
            )}
          </div>

          {/* Layer Table */}
          <div>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
              全量网络层明细
              <span className="ml-2 text-[10px] font-mono text-muted-foreground/60">({layers.length} layers)</span>
            </div>
            <LayerTable
              layers={layers}
              frameworkIds={task?.frameworks ?? []}
              loading={layersLoading}
              onSelectLayer={(l) => setSelectedLayer(l.layerName)}
              selectedLayerName={selectedLayer}
            />
          </div>

          {/* Execution Tree */}
          {graphData && (
            <div className="pt-2">
              <ExecutionTree
                graph={graphData}
                onSelectLayer={(name) => setSelectedLayer(name)}
                selectedLayer={selectedLayer}
              />
            </div>
          )}
        </div>

        {/* Floating layer tooltip */}
        {selectedLayerData && (
          <LayerTooltip
            layer={selectedLayerData}
            onClose={() => setSelectedLayer(null)}
          />
        )}
      </div>

      <TaskHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} onSelect={(id) => {
        loadRealTask(id)
      }} />
    </div>
  )
}
