import '@xyflow/react/dist/base.css'

import { useMemo, useState } from 'react'
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Maximize, Minus, Plus, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayName, entityHref, splitFqn } from '@/features/om/entity'
import { EntityIcon } from '@/features/om/components/EntityIcon'
import type { LineageEdge, LineageNode, LineageResponse } from '@/features/om/types'
import { cn } from '@/lib/utils'

/**
 * A lineage graph from OpenMetadata's getLineage answer. Nodes sit in columns
 * by depth (upstream left, downstream right); clicking an edge shows the SQL
 * that produced it and its column mappings.
 */

const COL_W = 300
const ROW_H = 96

type NodeData = { node: LineageNode; root: boolean; dim: boolean; onSelect?: (fqn: string) => void }

function layout(data: LineageResponse, rootId: string): { nodes: Node<NodeData>[]; edges: Edge<{ edge: LineageEdge }>[] } {
  const all = [...Object.values(data.upstreamEdges ?? {}), ...Object.values(data.downstreamEdges ?? {})]
  const unique = new Map(all.map((e) => [`${e.fromEntity.id}->${e.toEntity.id}`, e]))
  const depth = new Map<string, number>()
  for (const [id, n] of Object.entries(data.nodes)) depth.set(id, n.nodeDepth ?? (id === rootId ? 0 : 0))
  // Derive depth from edges when the server doesn't send nodeDepth: walk out from the root.
  if (![...depth.values()].some((d) => d !== 0)) {
    depth.clear()
    depth.set(rootId, 0)
    let changed = true
    while (changed) {
      changed = false
      for (const e of unique.values()) {
        const f = depth.get(e.fromEntity.id)
        const t = depth.get(e.toEntity.id)
        if (f !== undefined && t === undefined && f >= 0) (depth.set(e.toEntity.id, f + 1), (changed = true))
        if (t !== undefined && f === undefined && t <= 0) (depth.set(e.fromEntity.id, t - 1), (changed = true))
      }
    }
  }
  const columns = new Map<number, string[]>()
  for (const id of Object.keys(data.nodes)) {
    const d = depth.get(id) ?? 0
    columns.set(d, [...(columns.get(d) ?? []), id])
  }
  const nodes: Node<NodeData>[] = []
  for (const [d, ids] of columns) {
    ids.sort((a, b) => displayName(data.nodes[a]!.entity).localeCompare(displayName(data.nodes[b]!.entity)))
    ids.forEach((id, i) => {
      nodes.push({
        id,
        type: 'entity',
        position: { x: d * COL_W, y: (i - (ids.length - 1) / 2) * ROW_H },
        data: { node: data.nodes[id]!, root: id === rootId, dim: false },
      })
    })
  }
  const edges = [...unique.values()].map((e) => ({
    id: `${e.fromEntity.id}->${e.toEntity.id}`,
    source: e.fromEntity.id,
    target: e.toEntity.id,
    data: { edge: e },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--muted-foreground)' },
  }))
  return { nodes, edges }
}

function EntityNode({ data }: NodeProps<Node<NodeData>>) {
  const e = data.node.entity
  const parts = e.fullyQualifiedName ? splitFqn(e.fullyQualifiedName) : []
  const dataset = parts.length >= 3 ? parts.slice(-2, -1)[0] : undefined
  const up = data.node.paging?.entityUpstreamCount
  const down = data.node.paging?.entityDownstreamCount
  return (
    <div
      className={cn(
        'w-60 rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-elevation-1 transition-opacity',
        data.root && 'border-primary ring-2 ring-primary/30',
        data.dim && 'opacity-40',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <EntityIcon type={e.entityType ?? e.type} className="size-7" />
        <div className="min-w-0 flex-1">
          <a
            href={entityHref(e.entityType ?? e.type, e.fullyQualifiedName ?? e.name ?? '')}
            className="nodrag block truncate text-sm font-medium hover:underline"
            title={e.fullyQualifiedName}
          >
            {displayName(e)}
          </a>
          <div className="truncate text-xs text-muted-foreground">{dataset ?? e.type}</div>
        </div>
      </div>
      {(up !== undefined || down !== undefined) && (
        <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{up ?? 0} upstream</span>
          <span>{down ?? 0} downstream</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-muted-foreground" />
    </div>
  )
}

const NODE_TYPES = { entity: EntityNode }

export function LineageGraph({ data, rootId, className }: { data: LineageResponse; rootId: string; className?: string }) {
  return (
    <ReactFlowProvider>
      <Graph data={data} rootId={rootId} className={className} />
    </ReactFlowProvider>
  )
}

function Graph({ data, rootId, className }: { data: LineageResponse; rootId: string; className?: string }) {
  const base = useMemo(() => layout(data, rootId), [data, rootId])
  const [selected, setSelected] = useState<LineageEdge | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  // Hovering a node highlights its direct neighbours.
  const near = useMemo(() => {
    if (!hover) return null
    const s = new Set([hover])
    for (const e of base.edges) {
      if (e.source === hover) s.add(e.target)
      if (e.target === hover) s.add(e.source)
    }
    return s
  }, [hover, base.edges])

  const nodes = base.nodes.map((n) => ({ ...n, data: { ...n.data, dim: Boolean(near && !near.has(n.id)) } }))
  const selId = selected ? `${selected.fromEntity.id}->${selected.toEntity.id}` : null
  const edges = base.edges.map((e) => {
    const active = e.id === selId || (hover && (e.source === hover || e.target === hover))
    return {
      ...e,
      animated: e.id === selId,
      style: {
        stroke: active ? 'var(--primary)' : 'var(--muted-foreground)',
        strokeWidth: active ? 2 : 1.25,
        opacity: near && !active ? 0.25 : 1,
        cursor: 'pointer',
      },
    }
  })

  return (
    <div className={cn('relative h-full min-h-96 w-full', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onEdgeClick={(_, e) => setSelected((e.data as { edge: LineageEdge }).edge)}
        onPaneClick={() => setSelected(null)}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
      >
        <Background color="var(--border)" gap={20} />
        <ZoomControls />
      </ReactFlow>
      {selected && <EdgePanel edge={selected} data={data} onClose={() => setSelected(null)} />}
    </div>
  )
}

function ZoomControls() {
  const rf = useReactFlow()
  const buttons = [
    { label: 'Zoom in', icon: Plus, run: () => rf.zoomIn() },
    { label: 'Zoom out', icon: Minus, run: () => rf.zoomOut() },
    { label: 'Fit to screen', icon: Maximize, run: () => rf.fitView({ padding: 0.2 }) },
  ]
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border bg-card p-1 shadow-elevation-1">
      {buttons.map((b) => (
        <Tooltip key={b.label}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={b.label} onClick={b.run}>
              <b.icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{b.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function EdgePanel({ edge, data, onClose }: { edge: LineageEdge; data: LineageResponse; onClose: () => void }) {
  const from = data.nodes[edge.fromEntity.id]?.entity
  const to = data.nodes[edge.toEntity.id]?.entity
  const short = (fqn?: string) => (fqn ? splitFqn(fqn).pop() : '')
  return (
    <div className="absolute top-3 right-3 bottom-3 z-10 flex w-[min(28rem,calc(100%-1.5rem))] flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-elevation-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Lineage edge</div>
          <div className="truncate text-sm font-medium">
            {displayName(from)} → {displayName(to)}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {edge.source && <Badge variant="secondary">{edge.source.replace(/([A-Z])/g, ' $1').trim()}</Badge>}
      {edge.description && <p className="text-sm">{edge.description}</p>}
      {edge.columns && edge.columns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Columns</div>
          {edge.columns.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1 font-mono text-xs">
              <span>{(c.fromColumns ?? []).map(short).join(', ')}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-semibold">{short(c.toColumn)}</span>
            </div>
          ))}
        </div>
      )}
      {edge.sqlQuery && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">SQL</div>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {edge.sqlQuery}
          </pre>
        </div>
      )}
      {!edge.sqlQuery && !edge.columns?.length && (
        <p className="text-sm text-muted-foreground">No SQL or column mapping recorded for this edge.</p>
      )}
    </div>
  )
}
