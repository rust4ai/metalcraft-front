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
import { unhandledErrorNodes } from './analyze'
import { KIND_STYLES, look, portsOf, vendorOf } from './nodeKinds'
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
  /** Editing hooks. Absent means read-only, and the canvas turns off every
   *  interaction that would imply otherwise. */
  edit?: {
    selectedId?: string
    /** The edge being edited, if the selection is an edge rather than a node. */
    selectedEdgeId?: string
    onSelect: (id: string | undefined) => void
    onSelectEdge: (id: string | undefined) => void
    onMove: (id: string, to: [number, number]) => void
    onConnect: (source: string, target: string, handle?: string) => void
    onDeleteNode: (id: string) => void
    onDeleteEdge: (id: string) => void
  }
}

interface CardData extends Record<string, unknown> {
  nodeType: string
  data: Record<string, unknown>
  state?: 'visited' | 'failed' | 'waiting'
  /** Whether this node's `error` output goes nowhere. */
  unhandledError?: boolean
  /** Output ports to draw, `null` being the unnamed one — see `portsOf`. */
  ports: Array<string | null>
}

/** One node. */
function NodeCard({ data: card, selected }: NodeProps) {
  const { nodeType, data, state, unhandledError, ports } = card as CardData
  // One unnamed output is the ordinary case and stays a bare port on the edge of
  // the card; naming it would put the word "out" on almost every node in every
  // flow to say nothing.
  const plain = ports.length === 0 || (ports.length === 1 && ports[0] === null)
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
        selected && 'ring-2 ring-accent',
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

      {plain ? (
        ports.length > 0 && (
          <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-line !bg-ink-3" />
        )
      ) : (
        // A port per handle, each one draggable. Until this, a branch's outputs
        // existed only in its payload: the canvas drew one anonymous port, so
        // there was no way to say which arc was `yes` and which was `no` without
        // going to the edge and naming it by hand.
        <div className="-mx-3 mt-1.5 border-t border-line pt-1">
          {ports.map((port) => (
            <div key={port ?? '\u00b7'} className="relative flex h-[18px] items-center justify-end pr-3">
              <span
                className={cn(
                  'truncate font-mono text-[10px]',
                  port === 'error' ? 'text-orange' : 'text-ink-3',
                )}
              >
                {port ?? 'out'}
              </span>
              <Handle
                type="source"
                id={port ?? undefined}
                position={Position.Right}
                className="!h-2 !w-2 !border-line !bg-ink-3"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { card: NodeCard }

export function FlowGraph({
  definition,
  visited = [],
  failedAt,
  waitingAt,
  edit,
}: FlowGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const placed = positions(definition)
    const wasVisited = new Set(visited)

    // One pass over the edges rather than one per card.
    const unhandled = unhandledErrorNodes(definition)

    // Which handles each node's edges actually use, so a port is drawn for every
    // one of them and no edge can be bound to a port that is not there.
    const usedHandles = new Map<string, Array<string | null | undefined>>()
    for (const e of definition.edges ?? []) {
      const list = usedHandles.get(e.source) ?? []
      list.push(e.source_handle)
      usedHandles.set(e.source, list)
    }

    const cards: Node[] = (definition.nodes ?? []).map((n) => {
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
        selected: n.id === edit?.selectedId,
        data: {
          nodeType: n.node_type,
          data: (n.data ?? {}) as Record<string, unknown>,
          state,
          unhandledError: unhandled.has(n.id),
          ports: portsOf(
            n.node_type,
            (n.data ?? {}) as Record<string, unknown>,
            usedHandles.get(n.id) ?? [],
          ),
        } satisfies CardData,
      }
    })

    const arcs: Edge[] = (definition.edges ?? []).map((e) => {
      const onPath = wasVisited.has(e.source) && wasVisited.has(e.target)
      const isError = e.source_handle === 'error'
      const selected = e.id === edit?.selectedEdgeId
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        // Bound to the port of the same name, which `portsOf` guarantees exists —
        // it is derived from these very edges. React Flow drops an edge whose
        // handle matches no port, so that guarantee is the whole reason ports are
        // computed from the graph rather than from the node type alone.
        //
        // No label: the port the arc leaves from is already named on the card, and
        // printing `urgent` again forty pixels away is the same word twice.
        sourceHandle: e.source_handle ?? null,
        animated: onPath,
        selected: e.id === edit?.selectedEdgeId,
        style: {
          stroke: selected
            ? 'var(--color-accent)'
            : onPath
              ? 'var(--color-green)'
              : 'var(--color-line-strong)',
          strokeWidth: selected || onPath ? 1.5 : 1,
          // An error rail is a real edge but not the intended path; drawing it
          // like one makes every graph look like it forks constantly.
          strokeDasharray: isError ? '4 3' : undefined,
        },
      }
    })

    return { nodes: cards, edges: arcs }
  }, [definition, visited, failedAt, waitingAt, edit?.selectedId, edit?.selectedEdgeId])

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
      // Without `edit`, every interaction that would mutate the graph is off, so
      // the canvas cannot imply an affordance it does not have.
      nodesDraggable={Boolean(edit)}
      nodesConnectable={Boolean(edit)}
      edgesFocusable={Boolean(edit)}
      elementsSelectable={Boolean(edit)}
      onNodeClick={edit ? (_, n) => edit.onSelect(n.id) : undefined}
      // An edge is selectable in its own right: its handle is the only place a
      // forking node says which output goes where.
      onEdgeClick={edit ? (_, e) => edit.onSelectEdge(e.id) : undefined}
      onPaneClick={
        edit
          ? () => {
              edit.onSelect(undefined)
              edit.onSelectEdge(undefined)
            }
          : undefined
      }
      // Position is committed once, on drop. Committing per frame would make a
      // single drag a hundred undo steps and a hundred validation round trips.
      onNodeDragStop={
        edit ? (_, n) => edit.onMove(n.id, [Math.round(n.position.x), Math.round(n.position.y)]) : undefined
      }
      onConnect={
        edit
          ? (c) =>
              // The port dragged from *is* the handle — the whole point of
              // drawing one port per output.
              c.source && c.target && edit.onConnect(c.source, c.target, c.sourceHandle ?? undefined)
          : undefined
      }
      onNodesDelete={edit ? (deleted) => deleted.forEach((n) => edit.onDeleteNode(n.id)) : undefined}
      onEdgesDelete={edit ? (deleted) => deleted.forEach((e) => edit.onDeleteEdge(e.id)) : undefined}
      proOptions={{ hideAttribution: true }}
      className="bg-canvas"
    >
      <Background gap={16} size={1} color="var(--color-line)" />
      <Controls showInteractive={false} className="!shadow-card" />
    </ReactFlow>
  )
}
