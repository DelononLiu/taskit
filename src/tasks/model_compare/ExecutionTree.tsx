import { cn } from '@/lib/utils'
import type { GraphData, GraphNode } from '@/types'

interface Props {
  graph: GraphData
  onSelectLayer?: (name: string) => void
  selectedLayer?: string | null
}

function nodeColor(cos: number | null | undefined): string {
  if (cos == null) return '#666'
  if (cos >= 0.99) return '#22c55e'
  if (cos >= 0.95) return '#eab308'
  return '#ef4444'
}

function nodeLabel(cos: number | null | undefined): string {
  if (cos == null) return '—'
  return cos.toFixed(4)
}

/**
 * 执行链路树 — 按拓扑深度展示采样层 DAG。
 * 同一 depth 的节点水平展开，edges 用连线和箭头表示。
 */
export function ExecutionTree({ graph, onSelectLayer, selectedLayer }: Props) {
  if (!graph.nodes.length) return null

  const maxDepth = Math.max(...graph.nodes.map((n) => n.depth))
  const nodeMap = new Map<string, GraphNode>()
  graph.nodes.forEach((n) => nodeMap.set(n.name, n))

  // 按 depth 分组
  const byDepth: Map<number, GraphNode[]> = new Map()
  graph.nodes.forEach((n) => {
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, [])
    byDepth.get(n.depth)!.push(n)
  })

  // 每个 depth 的 children 集合（用于画竖线）
  const childrenAtDepth = new Map<number, Set<string>>()
  for (let d = 0; d <= maxDepth; d++) {
    childrenAtDepth.set(d, new Set())
  }
  for (const edge of graph.edges) {
    const srcNode = nodeMap.get(edge.from)
    const dstNode = nodeMap.get(edge.to)
    if (srcNode && dstNode) {
      childrenAtDepth.get(srcNode.depth)?.add(edge.from)
    }
  }

  return (
    <div className="rounded-lg border border-muted bg-card overflow-x-auto">
      <div className="px-3.5 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-muted flex items-center gap-2">
        执行链路
        <span className="text-[10px] font-mono text-muted-foreground/60 font-normal">
          ({graph.nodes.length} nodes, {graph.edges.length} edges)
        </span>
      </div>

      <div className="p-3 font-mono text-[11px] leading-relaxed">
        {/* 按 depth 逐行渲染 */}
        {Array.from({ length: maxDepth + 1 }, (_, depth) => {
          const nodes = byDepth.get(depth) ?? []
          if (nodes.length === 0) return null

          // 这一 depth 中有节点的 edge 需要画竖线延续
          const hasChildren = childrenAtDepth.get(depth)?.size ?? 0 > 0

          // 找到从这一层出发的所有 edge
          const outEdges = graph.edges.filter((e) => {
            const src = nodeMap.get(e.from)
            return src && src.depth === depth
          })

          // 下游 depth
          const nextDepths = new Set<number>()
          for (const e of outEdges) {
            const dst = nodeMap.get(e.to)
            if (dst) nextDepths.add(dst.depth)
          }

          return (
            <div key={depth}>
              {/* 节点行 */}
              <div className="flex flex-wrap items-center gap-1 py-0.5">
                {/* depth 指示器 */}
                <span className="text-muted-foreground/40 w-4 shrink-0 text-[10px]">
                  {depth}
                </span>
                {/* 缩进 */}
                <span className="text-muted-foreground/20 select-none">
                  {'│ '.repeat(Math.max(0, depth))}
                </span>
                {/* 此 depth 的节点 */}
                {nodes.map((node, ni) => {
                  const cos = node.cosineSimilarity
                  const color = nodeColor(cos)
                  const isSelected = selectedLayer === node.name
                  const isLeaf = node.isLeaf

                  // 节点间的连接
                  const hasNext = ni < nodes.length - 1
                  const connector = hasNext ? '─' : ' '

                  return (
                    <span key={node.name} className="inline-flex items-center gap-0.5">
                      {ni > 0 && (
                        <span className="text-muted-foreground/20">{' '}{connector}{' '}</span>
                      )}
                      <button
                        onClick={() => onSelectLayer?.(node.name)}
                        className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                          isSelected
                            ? 'bg-accent ring-1 ring-border'
                            : 'hover:bg-accent/50'
                        )}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: color }}
                        />
                        <span className="truncate max-w-[160px]" title={node.name}>
                          {node.name}
                        </span>
                        <span className="text-[10px] font-bold tabular-nums shrink-0"
                          style={{ color }}>
                          {nodeLabel(cos)}
                        </span>
                        {isLeaf && (
                          <span className="text-[9px] text-muted-foreground/40 ml-0.5">📥</span>
                        )}
                      </button>
                    </span>
                  )
                })}
              </div>

              {/* 如果有跨 depth 的 edge，画竖线箭头指示 */}
              {outEdges.length > 0 && depth < maxDepth && (
                <div className="flex items-start ml-4 text-muted-foreground/30 text-[10px] leading-none py-0.5">
                  <span className="mr-1">↓</span>
                  <span>
                    →{' '}
                    {[...new Set(outEdges.map((e) => {
                      const dst = nodeMap.get(e.to)
                      return dst ? `d${dst.depth}` : ''
                    }))].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )
        })}

        {/* 图例 */}
        <div className="flex items-center gap-3 mt-3 pt-2 border-t border-muted text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: '#22c55e' }} /> ≥0.99
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: '#eab308' }} /> ≥0.95
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} /> {'<'}0.95
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: '#666' }} /> N/A
          </span>
          <span className="ml-2">📥 模型输出</span>
        </div>
      </div>
    </div>
  )
}
