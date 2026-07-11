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
