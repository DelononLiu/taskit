import React from 'react'
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
