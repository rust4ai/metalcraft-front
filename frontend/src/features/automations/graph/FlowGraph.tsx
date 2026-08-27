import { useMemo } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { positions } from './layout'
import { KIND_STYLES, look, vendorOf } from './nodeKinds'
import type { FlowDefinition } from '@/types'
import { cn } from '@/lib/cn'

/**
 * A flow, drawn.
 *
 * Read-only. Editing is a separate phase and a much larger surface; the question
 * this answers first is "what does this automation actually do", which nobody
 * could answer without reading the JSON on disk.
 *
 * The pod's wire format maps onto React Flow almost exactly — `position`,
 * `source_handle`/`target_handle` — which is not a coincidence: the flow spec
 * documents `position` as being "for visual editors" and allows disconnected
 * nodes precisely so one can hold scratch state. This component is the consumer
 * that shape was written for.
 */
export interface FlowGraphProps {
  definition: FlowDefinition
  /** Node ids this run visited, in order — see `RunOverlay`. Empty means a plain
   *  structural view. */
  visited?: string[]
  /** The node the run stopped on, if it stopped badly. */
  failedAt?: string
  /** Where the run is parked, waiting on a person or a clock. */
  waitingAt?: string
}

interface CardData extends Record<string, unknown> {
  nodeType: string
  data: Record<string, unknown>
  state?: 'visited' | 'failed' | 'waiting'
  /** Whether this node's `error` output goes nowhere. */
  unhandledError?: boolean
}

/** One node. */
function NodeCard({ data: card }: NodeProps) {
  const { nodeType, data, state, unhandledError } = card as CardData
  const info = look(nodeType)
  const style = KIND_STYLES[info.kind]
  const Icon = info.icon
  const vendor = vendorOf(nodeType)
  const summary = info.summary?.(data)

  return (
    <div
      className={cn(
        'w-[220px] rounded-card border bg-surface px-3 py-2 shadow-card transition-shadow',
        style.ring,
        state === 'visited' && 'border-green/60 shadow-raised',
        state === 'failed' && 'border-red/70 shadow-raised',
        state === 'waiting' && 'border-accent/70 shadow-raised',
      )}
    >
      {/* An entry node has nothing upstream of it; drawing a target port would
          invite a connection the runtime would never follow. */}
      {nodeType !== 'entry' && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-line !bg-ink-3" />
      )}

      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', style.icon)} />
        <span className="truncate text-[12.5px] font-medium text-ink">{info.label}</span>
        {info.thinks && (
          <span
            title="Runs a model"
            className="ml-auto shrink-0 rounded-chip bg-accent-tint px-1 text-[9.5px] font-medium uppercase tracking-wide text-accent"
          >
            llm
          </span>
        )}
      </div>

      {vendor && (
        <div className={cn('mt-1 inline-block rounded-chip px-1.5 py-0.5 text-[10px]', style.chip)}>
          {vendor}
        </div>
      )}

      {summary && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-2">{summary}</p>}

      {/* The single most useful thing a viewer can say about a graph: this node
          can fail and nothing catches it, so the run dies here. An unwired
          `error` rail fails the whole run (SPEC §5.4) and is invisible in JSON. */}
      {unhandledError && (
        <p className="mt-1 text-[10.5px] leading-snug text-orange">failure is unhandled</p>
      )}

      {info.handles && info.handles.length === 0 ? null : (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-ink-3" />
      )}
    </div>
  )
}

const nodeTypes = { card: NodeCard }

export function FlowGraph({ definition, visited = [], failedAt, waitingAt }: FlowGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const placed = positions(definition)
    const wasVisited = new Set(visited)

    // Which nodes have an `error` output that goes nowhere. Computed here rather
    // than per-card so it costs one pass over the edges instead of one per node.
    const wiredErrors = new Set(
      (definition.edges ?? []).filter((e) => e.source_handle === 'error').map((e) => e.source),
    )

    const nodes: Node[] = (definition.nodes ?? []).map((n) => {
      const info = look(n.node_type)
      const at = placed.get(n.id)
      const state =
        n.id === failedAt
          ? ('failed' as const)
          : n.id === waitingAt
            ? ('waiting' as const)
            : wasVisited.has(n.id)
              ? ('visited' as const)
              : undefined
      return {
        id: n.id,
        type: 'card',
        position: { x: at?.x ?? 0, y: at?.y ?? 0 },
        data: {
          nodeType: n.node_type,
          data: (n.data ?? {}) as Record<string, unknown>,
          state,
          unhandledError: (info.handles?.includes('error') ?? false) && !wiredErrors.has(n.id),
        } satisfies CardData,
      }
    })

    const edges: Edge[] = (definition.edges ?? []).map((e) => {
      const onPath = wasVisited.has(e.source) && wasVisited.has(e.target)
      const isError = e.source_handle === 'error'
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        // The handle names are the flow's vocabulary, not React Flow's port ids —
        // the cards draw one port per side — so they are shown as labels rather
        // than bound to `sourceHandle`, which would silently drop every edge
        // whose handle has no matching port.
        label: e.source_handle ?? undefined,
        labelStyle: { fontSize: 10, fill: 'var(--color-ink-3)' },
        labelBgStyle: { fill: 'var(--color-surface)' },
        animated: onPath,
        style: {
          stroke: onPath ? 'var(--color-green)' : 'var(--color-line-strong)',
          strokeWidth: onPath ? 1.5 : 1,
          // An error rail is a real edge but not the intended path; drawing it
          // like one makes every graph look like it forks constantly.
          strokeDasharray: isError ? '4 3' : undefined,
        },
      }
    })

    return { nodes, edges }
  }, [definition, visited, failedAt, waitingAt])

  if (nodes.length === 0) {
    return (
      <p className="p-6 text-center text-[12px] text-ink-3">
        This flow has no steps yet.
      </p>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      // Read-only: every interaction that would mutate the graph is off, so the
      // canvas cannot imply an editing affordance it does not have.
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      proOptions={{ hideAttribution: true }}
      className="bg-canvas"
    >
      <Background gap={16} size={1} color="var(--color-line)" />
      <Controls showInteractive={false} className="!shadow-card" />
    </ReactFlow>
  )
}
