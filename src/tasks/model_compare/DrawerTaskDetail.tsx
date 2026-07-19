import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getTask, getTaskLayers } from '@/api/task'
import { OverviewChart } from './OverviewChart'
import { LayerTable } from './LayerTable'
import { ExecutionTree } from './ExecutionTree'
import type { ComparisonTask, LayerDiff, LayerMetric, GraphData } from '@/types'
import { formatSize, extractArch, mockParams } from './utils'
import { MOCK_TASK_IDS, MOCK_LAYERS_ALL_PASS, MOCK_LAYERS_HAS_FAIL, buildMockTask } from './mockData'
import { FW_OPTIONS } from './constants'
import { USE_MOCK } from '@/lib/env'

interface DrawerTaskDetailProps {
  taskId: number
}

export function DrawerTaskDetail({ taskId }: DrawerTaskDetailProps) {
  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [layers, setLayers] = useState<LayerDiff[]>([])
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [layersLoading, setLayersLoading] = useState(true)
  const [selectedFramework, setSelectedFramework] = useState('tensorrt')
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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
    setLoadError(null)
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
      const failed = rawLayers.find((l: LayerDiff) => l.metrics?.some((m: LayerMetric) => !m.passed))
      setSelectedLayer(failed?.layerName ?? null)
    } catch (e) {
      console.error('load task failed', e)
      setLoadError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLayersLoading(false)
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-fail/30 bg-fail/5 p-4">
        <p className="text-sm font-medium text-fail">加载失败</p>
        <p className="text-xs text-fail/80 mt-1">{loadError}</p>
      </div>
    )
  }

  if (!task) return null

  return (
    <div className="space-y-5">
      {/* Model Info */}
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

      {/* Status bar */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] font-mono h-5 px-1.5',
            task.status === 'completed' ? 'border-pass/40 text-pass' :
            task.status === 'failed' ? 'border-fail/40 text-fail' :
            'border-warn/40 text-warn'
          )}
        >
          {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : '进行中'}
        </Badge>
        <span>#{task.id}</span>
        <span className="text-muted-foreground/40">|</span>
        <span>{new Date(task.createdAt).toLocaleString()}</span>
      </div>

      {/* Accuracy Metrics — only show if comparisons exist */}
      {task.comparisons && task.comparisons.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            精度指标
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {task.comparisons.map((c) => {
              const fwColor = FW_OPTIONS.find(f => f.value === c.framework.id)?.color ?? '#666'
              return (
                <div key={c.framework.id} className="rounded-lg border border-muted bg-card p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: fwColor }} />
                    <span className="text-xs font-semibold" style={{ color: fwColor }}>{c.framework.name}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">余弦相似度</span>
                      <span className={cn('font-mono font-bold tabular-nums', c.overallMetrics.avgCosineSimilarity >= 0.99 ? 'text-pass' : 'text-fail')}>
                        {c.overallMetrics.avgCosineSimilarity.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">通过率</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {c.overallMetrics.passedLayers}/{c.overallMetrics.totalLayers}
                        <span className={cn('ml-1', c.overallMetrics.failedLayers === 0 ? 'text-pass' : 'text-fail')}>
                          ({c.overallMetrics.totalLayers > 0
                            ? ((c.overallMetrics.passedLayers / c.overallMetrics.totalLayers) * 100).toFixed(0)
                            : 0}%)
                        </span>
                      </span>
                    </div>
                    {c.overallMetrics.worstLayer && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">最差层</span>
                        <span className="font-mono text-fail">{c.overallMetrics.worstLayer}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Layer Cosine + Radar Chart */}
      <div className="grid grid-cols-1 gap-3">
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
        <div className="pt-1">
          <ExecutionTree
            graph={graphData}
            onSelectLayer={(name) => setSelectedLayer(name)}
            selectedLayer={selectedLayer}
          />
        </div>
      )}

      {/* Selected layer detail summary (inline replacement for floating LayerTooltip) */}
      {selectedLayerData && (
        <div className="rounded-lg border border-muted bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{selectedLayerData.layerName}</span>
            <button
              onClick={() => setSelectedLayer(null)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            类型: <span className="font-mono text-foreground">{selectedLayerData.layerType}</span>
          </div>
          <div className="grid grid-cols-1 gap-1">
            {selectedLayerData.metrics.map((m) => {
              const fwColor = FW_OPTIONS.find(f => f.value === m.frameworkId)?.color ?? '#666'
              return (
                <div key={m.frameworkId} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-muted/30">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fwColor }} />
                    <span className="font-medium" style={{ color: fwColor }}>{m.frameworkId}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className={m.passed ? 'text-pass' : 'text-fail'}>
                      cos={m.cosineSimilarity.toFixed(4)}
                    </span>
                    <span className="text-muted-foreground">
                      err={m.maxAbsError.toExponential(3)}
                    </span>
                    <span className="text-muted-foreground">
                      SNR={m.snr != null ? m.snr.toFixed(1) : '—'}dB
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* LLM Log Summary */}
      <div className="rounded-lg border border-muted bg-card">
        <div className="px-3.5 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-muted">
          LLM 日志摘要
        </div>
        <div className="p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-mono text-[11px]">
            <span className="text-green-600/80">[INFO]</span> 任务 #{task.id} 加载完成
          </p>
          <p className="font-mono text-[11px]">
            <span className="text-green-600/80">[INFO]</span> 模型 {task.model?.name} 共 {layers.length} 层
          </p>
          {task.status === 'completed' && (
            <p className="font-mono text-[11px]">
              <span className="text-green-600/80">[INFO]</span> 精度分析完成
            </p>
          )}
          {task.status === 'failed' && (
            <p className="font-mono text-[11px]">
              <span className="text-red-500/80">[ERROR]</span> 推理过程出现异常
            </p>
          )}
          <p className="font-mono text-[11px]">
            <span className="text-muted-foreground/60">[END]</span> 报告生成完毕
          </p>
        </div>
      </div>
    </div>
  )
}
