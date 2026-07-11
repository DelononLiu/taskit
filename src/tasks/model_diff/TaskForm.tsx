import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileIcon, Loader2, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { uploadModel } from '@/api/model'
import { createTask, getTask, getTaskLayers, getTaskHistory, cancelTask, retryTask } from '@/api/task'
import type { ModelFile, ComparisonTask, LayerDiff, LayerMetric } from '@/types'
import { formatSize, extractArch, mockParams } from './utils'
import { MOCK_RECENT, MOCK_TASKS, MOCK_LAYERS_ALL_PASS, MOCK_LAYERS_HAS_FAIL, buildMockTask } from './mockData'
import { TaskHistoryDrawer } from '@/core/components/TaskHistoryDrawer'
import { TopNav } from '@/core/components/TopNav'
import { FW_OPTIONS } from './constants'
import { USE_MOCK } from '@/lib/env'

interface Props {
  onTaskCreated: (taskId: number) => void
}

export function ModelDiffForm({ onTaskCreated }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [boxState, setBoxState] = useState<'empty' | 'config' | 'running'>('empty')
  const [model, setModel] = useState<ModelFile | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [comparisonFws, setComparisonFws] = useState<string[]>([])
  const [baselineFw, setBaselineFw] = useState('onnxruntime')
  const [batchSize, setBatchSize] = useState('4')
  const [precision, setPrecision] = useState('auto')
  const [inputSource, setInputSource] = useState<'random' | 'text' | 'file'>('random')
  const [inputText, setInputText] = useState('')
  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [recentTasks, setRecentTasks] = useState<typeof MOCK_RECENT>([])
  const pollRefsRef = useRef<Map<number, { current: boolean }>>(new Map())
  useEffect(() => {
    return () => {
      pollRefsRef.current.forEach((ref) => { ref.current = false })
      pollRefsRef.current.clear()
    }
  }, [])

  // 加载真实最近任务
  useEffect(() => {
    if (USE_MOCK) {
      setRecentTasks(MOCK_RECENT)
    } else {
      getTaskHistory(1, 3).then((tasks) => setRecentTasks(tasks as any)).catch(() => {})
    }
  }, [])

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith('.onnx')) return
    setSelectedFile(file)
    setBoxState('config')
  }, [])

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setModel(null)
    setBoxState('empty')
    setUploadProgress(0)
  }

  const handleRun = async () => {
    if (!selectedFile || comparisonFws.length === 0) return
    setBoxState('running')
    setRunning(true)
    setLogs([])
    setTask(null)
    setUploadProgress(0)
    try {
      // Phase 1: upload model
      const m = await uploadModel(selectedFile, (pct) => setUploadProgress(pct))
      setModel(m)
      setUploadProgress(100)

      // Phase 2: create analysis task
      const t = await createTask({
        modelId: m.id,
        frameworks: [...new Set([baselineFw, ...comparisonFws])],
        params: {
          precision,
          batchSize: Number(batchSize),
          inputSource,
          ...(inputSource === 'text' ? { inputText } : {}),
        },
      })
      setTask(t)

      // Phase 3: poll for results (safe setTimeout with cleanup)
      const pollRef = { current: true }
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
          if (updated.status === 'completed') {
            setRunning(false)
            onTaskCreated(t.id)
            pollRefsRef.current.delete(t.id)
            return
          }
          if (updated.status === 'failed') {
            setRunning(false)
            pollRefsRef.current.delete(t.id)
            return
          }
          setTimeout(poll, 1500)
        } catch (e) {
          console.error('poll error', e)
          if (pollRef.current) setTimeout(poll, 1500)
        }
      }
      poll()
    } catch {
      setBoxState('config')
      setRunning(false)
    }
  }

  const handleRetry = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    const t = await retryTask(id)
    onTaskCreated(t.id)
  }

  const handleViewRecent = async (id: number) => {
    if (USE_MOCK) {
      onTaskCreated(id)
      return
    }
    onTaskCreated(id)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav onOpenHistory={() => setHistoryOpen(true)} />

      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8 bg-muted/30">
        <h1 className="text-xl font-semibold tracking-tight mb-6">神经网络模型精度比对</h1>

        <div className="w-full max-w-[640px]">
          {boxState === 'empty' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f) }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-accent/30'
              )}
            >
              <input ref={fileInputRef} type="file" accept=".onnx" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
              <div className="rounded-full bg-primary/10 w-10 h-10 flex items-center justify-center mx-auto mb-3">
                <Upload className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">点击或拖拽选择 .onnx 文件</p>
              <p className="text-xs text-muted-foreground/60 mt-1">放置文件在此处。最大支持 2 GB</p>
            </div>
          )}

          {boxState === 'config' && selectedFile && (
            <div className="border rounded-xl p-6 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <FileIcon className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(selectedFile.size)}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">待上传</Badge>
                </div>
                <button onClick={handleRemoveFile} className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2">✕</button>
              </div>
              <div className="h-px bg-border" />
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">配置比对参数</p>
                <div className="grid grid-cols-2 gap-3">
                  {/* Baseline framework */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">基准框架</label>
                    <Select value={baselineFw} onValueChange={setBaselineFw}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FW_OPTIONS.map((fw) => (
                          <SelectItem key={fw.value} value={fw.value} className="text-xs">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: fw.color }} />
                              {fw.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Comparison frameworks */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">对比框架</label>
                    <div className="flex flex-col gap-1.5 pt-0.5">
                      {FW_OPTIONS.map((fw) => (
                        <label key={fw.value} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={comparisonFws.includes(fw.value)}
                            onCheckedChange={(checked) => {
                              setComparisonFws((prev) =>
                                checked ? [...prev, fw.value] : prev.filter((v) => v !== fw.value)
                              )
                            }}
                          />
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: fw.color }} />
                            {fw.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
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
                </div>
                {/* Input source */}
                <div className="space-y-1.5">
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
                  {inputSource === 'file' && (
                    <div className="mt-1.5 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-accent/30 transition-colors"
                      onClick={() => fileInputRef.current?.click()}>
                      <p className="text-xs text-muted-foreground">点击选择输入数据文件</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="h-px bg-border" />
              <Button className="w-full h-10 text-sm gap-2"
                disabled={comparisonFws.length === 0} onClick={handleRun}>
                <Layers className="h-4 w-4" />
                开始分析（预计耗时 ~10 分钟）
              </Button>
            </div>
          )}

          {boxState === 'running' && (
            <div className="border rounded-xl p-6 space-y-4">
              {task ? (
                <>
                  <div className="flex items-center gap-3">
                    {task.error ? (
                      <div className="h-5 w-5 rounded-full bg-fail/20 flex items-center justify-center shrink-0">
                        <span className="text-fail text-xs font-bold">!</span>
                      </div>
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{task.error ? '分析失败' : `正在分析: ${model?.name}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.error ? task.error : `进度: ${task.progress}%  |  ETA: 估算中`}
                      </p>
                    </div>
                  </div>
                  {!task.error && <Progress value={task.progress} className="h-2" />}
                  <div className="bg-black/40 rounded-md p-3 h-28 overflow-y-auto font-mono text-[11px] space-y-0.5">
                    {logs.map((log, i) => <div key={i} className="text-green-400/80">{log}</div>)}
                    {task.error && <div className="text-red-400/90 text-[11px]">{task.error}</div>}
                    {logs.length === 0 && !task.error && <div className="text-muted-foreground/50">等待执行日志...</div>}
                  </div>
                  {!task.error && (
                    <button
                      onClick={async () => {
                        await cancelTask(task.id)
                        setRunning(false)
                        setBoxState('empty')
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      取消任务
                    </button>
                  )}
                  {task.error && (
                    <button
                      onClick={async () => {
                        const t = await retryTask(task.id)
                        onTaskCreated(t.id)
                      }}
                      className="text-xs text-primary hover:underline transition-colors"
                    >
                      重试任务
                    </button>
                  )}
                </>
              ) : (
                /* Upload phase (before task creation) */
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium">正在上传模型...</p>
                      <p className="text-xs text-muted-foreground">进度: {uploadProgress}%</p>
                    </div>
                  </div>
                  {uploadProgress > 0 && <Progress value={uploadProgress} className="h-2" />}
                  <div className="bg-black/40 rounded-md p-3 h-28 overflow-y-auto font-mono text-[11px] space-y-0.5">
                    {logs.map((log, i) => <div key={i} className="text-green-400/80">{log}</div>)}
                    {logs.length === 0 && <div className="text-muted-foreground/50">等待上传...</div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent tasks */}
        <div className="w-full max-w-[640px] mt-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">最近分析任务</span>
            <button onClick={() => setHistoryOpen(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              查看全部 ➔
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {recentTasks.map((r) => (
              <button key={r.id} onClick={() => handleViewRecent(r.id)}
                className="text-left border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors space-y-2">
                <div className="flex items-center gap-2">
                  <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">{r.name}</span>
                </div>
                <div>
                  {r.status === 'completed' && (
                    <span className={cn('text-[11px]', r.accuracy?.includes('完美') ? 'text-pass' : 'text-warn')}>{r.accuracy}</span>
                  )}
                  {r.status === 'failed' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-fail">{r.accuracy}</span>
                      <button onClick={(e) => handleRetry(e, r.id)} className="text-[10px] text-primary hover:underline">重试</button>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <TaskHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} onSelect={handleViewRecent} />
    </div>
  )
}
