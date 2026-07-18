import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileIcon, Loader2, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { uploadModel } from '@/api/model'
import { createTask, getTask, cancelTask, retryTask } from '@/api/task'
import type { ModelFile, ComparisonTask } from '@/types'
import { formatSize } from './utils'
import { FW_OPTIONS } from './constants'
import { useToast } from '@/components/ui/toast'

interface DrawerTaskFormProps {
  onSuccess?: () => void
}

export function DrawerTaskForm({ onSuccess }: DrawerTaskFormProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [boxState, setBoxState] = useState<'empty' | 'config' | 'running'>('empty')
  const [model, setModel] = useState<ModelFile | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [comparisonSlots, setComparisonSlots] = useState<{ frameworkId: string; precision: string }[]>([
    { frameworkId: 'tensorrt', precision: 'auto' },
  ])
  const [baselineFw, setBaselineFw] = useState('onnxruntime')
  const [baselinePrecision, setBaselinePrecision] = useState('auto')
  const [batchSize, setBatchSize] = useState('4')
  const [inputSource, setInputSource] = useState<'random' | 'text' | 'file'>('random')
  const [inputText, setInputText] = useState('')
  const [task, setTask] = useState<ComparisonTask | null>(null)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const pollRefsRef = useRef<Map<number, { current: boolean }>>(new Map())

  // Cleanup poll refs on unmount
  useEffect(() => {
    return () => {
      pollRefsRef.current.forEach((ref) => { ref.current = false })
      pollRefsRef.current.clear()
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
    if (!selectedFile || comparisonSlots.length === 0) return

    // Validation: check for duplicate framework+precision combos
    const allSlots = [
      { frameworkId: 'onnxruntime', precision: baselinePrecision },
      ...comparisonSlots,
    ]
    const seen = new Set<string>()
    for (const slot of allSlots) {
      const key = `${slot.frameworkId}:${slot.precision}`
      if (seen.has(key)) {
        toast({
          title: '配置冲突',
          description: `${FW_OPTIONS.find(f => f.value === slot.frameworkId)?.label} (${slot.precision}) 重复配置，请调整`,
          variant: 'destructive',
        })
        return
      }
      seen.add(key)
    }

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
      const allFrameworks = [baselineFw, ...comparisonSlots.map(s => s.frameworkId)]
      const t = await createTask({
        modelId: m.id,
        frameworks: [...new Set(allFrameworks)],
        params: {
          slots: [
            { frameworkId: 'onnxruntime', precision: baselinePrecision },
            ...comparisonSlots,
          ],
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
            `[${new Date().toLocaleTimeString()}] ${comparisonSlots.map(s => s.frameworkId).join('/')} 执行中 ${updated.progress}%`,
          ])
          if (updated.status === 'completed') {
            setRunning(false)
            toast({ title: '分析完成', description: `任务 #${t.id} 已完成` })
            onSuccess?.()
            pollRefsRef.current.delete(t.id)
            return
          }
          if (updated.status === 'failed') {
            setRunning(false)
            toast({ title: '分析失败', description: updated.error || '未知错误', variant: 'destructive' })
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
      toast({ title: '分析启动失败', description: '请检查网络连接后重试', variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
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
            {/* Framework selectors — three columns with per-slot precision */}
            <div className="grid grid-cols-3 gap-3">
              {/* Baseline — always ONNX Runtime */}
              <div className="border border-brand-accent/20 rounded-lg py-2.5 px-3 bg-brand-accent/5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">基准</div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-brand-accent" />
                  <span className="text-xs font-semibold">ONNX Runtime</span>
                </div>
                <Select value={baselinePrecision} onValueChange={setBaselinePrecision}>
                  <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['auto', 'fp32', 'fp16', 'int8'].map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">{p.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Comparison slot 1 */}
              <div className="border border-[#9333ea]/20 rounded-lg py-2.5 px-3 bg-[#9333ea]/5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">对比 1</div>
                <Select value={comparisonSlots[0]?.frameworkId || ''} onValueChange={(v) => {
                  setComparisonSlots([{ ...comparisonSlots[0], frameworkId: v }])
                }}>
                  <SelectTrigger className="h-7 text-[11px] mb-1"><SelectValue placeholder="框架" /></SelectTrigger>
                  <SelectContent>
                    {FW_OPTIONS.map((fw) => (
                      <SelectItem key={fw.value} value={fw.value} className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fw.color }} />
                          {fw.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={comparisonSlots[0]?.precision || 'auto'} onValueChange={(v) => {
                  setComparisonSlots([{ ...comparisonSlots[0], precision: v }])
                }}>
                  <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['auto', 'fp32', 'fp16', 'int8'].map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">{p.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Comparison slot 2 — optional */}
              {comparisonSlots.length >= 2 ? (
                <div className="border border-[#f97316]/20 rounded-lg py-2.5 px-3 bg-[#f97316]/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">对比 2</span>
                    <button onClick={() => setComparisonSlots([comparisonSlots[0]])}
                      className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                  <Select value={comparisonSlots[1]?.frameworkId || ''} onValueChange={(v) => {
                    setComparisonSlots([comparisonSlots[0], { ...comparisonSlots[1], frameworkId: v }])
                  }}>
                    <SelectTrigger className="h-7 text-[11px] mb-1"><SelectValue placeholder="框架" /></SelectTrigger>
                    <SelectContent>
                      {FW_OPTIONS.map((fw) => (
                        <SelectItem key={fw.value} value={fw.value} className="text-xs">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fw.color }} />
                            {fw.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={comparisonSlots[1]?.precision || 'auto'} onValueChange={(v) => {
                    setComparisonSlots([comparisonSlots[0], { ...comparisonSlots[1], precision: v }])
                  }}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['auto', 'fp32', 'fp16', 'int8'].map((p) => (
                        <SelectItem key={p} value={p} className="text-xs">{p.toUpperCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <button onClick={() => {
                  const used = comparisonSlots.map(s => s.frameworkId)
                  const first = FW_OPTIONS.find(fw => !used.includes(fw.value)) || FW_OPTIONS[0]
                  setComparisonSlots([...comparisonSlots, { frameworkId: first.value, precision: 'auto' }])
                }}
                  className="border border-dashed border-border rounded-lg py-2.5 px-3 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors cursor-pointer">
                  <span className="text-lg leading-none">+</span>
                  <span className="text-[10px]">添加对比</span>
                </button>
              )}
            </div>

            {/* 更多推理配置 — collapsed */}
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none list-none flex items-center gap-1">
                <span className="transition-transform group-open:rotate-90 text-[10px]">▶</span>
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
                {/* Precision (info only — per-framework precision is in cards above) */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">推理精度</label>
                  <div className="h-8 flex items-center text-xs text-muted-foreground/60">
                    已在上方按框架分别设置
                  </div>
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
                  {inputSource === 'file' && (
                    <div className="mt-1.5 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-accent/30 transition-colors"
                      onClick={() => fileInputRef.current?.click()}>
                      <p className="text-xs text-muted-foreground">点击选择输入数据文件</p>
                    </div>
                  )}
                </div>
              </div>
            </details>
          </div>
          <div className="h-px bg-border" />
          <Button className="w-full h-10 text-sm gap-2"
            disabled={comparisonSlots.length === 0} onClick={handleRun}>
            <Layers className="h-4 w-4" />
            {comparisonSlots.length > 0
              ? `开始分析（${comparisonSlots.map(s => `${FW_OPTIONS.find(f => f.value === s.frameworkId)?.label || s.frameworkId} ${s.precision.toUpperCase()}`).join(' + ')}）`
              : '请选择对比框架'}
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
                    await retryTask(task.id)
                    onSuccess?.()
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
  )
}
