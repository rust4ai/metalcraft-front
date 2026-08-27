import type { FlowDefinition, FlowEdge, FlowNode } from '@/types'

/**
 * Where to draw each node.
 *
 * Most flows have **no usable coordinates**. `position` is optional in the spec
 * and defaults to `[0, 0]`, and everything the pod produces itself — pack-shipped
 * flows, seed templates, anything the agent authored with its `flow_*` tools —
 * leaves it at the default. Rendering those honestly would stack every node on
 * one point, so a graph with no layout gets one computed.
 *
 * Deliberately **not** a dagre/elk dependency. What is needed here is "rank by
 * distance from the entry, spread within the rank", which is thirty lines and no
 * supply chain. If flows ever grow to the size where crossing-minimization
 * matters, that is the moment to reach for a real layout engine, not before.
 */

/** Horizontal distance between ranks. Wide enough for an edge label to sit in. */
const RANK_GAP = 260
/** Vertical distance between nodes sharing a rank. Tall enough for a card that
 *  lists its output ports — a branch with four handles is four rows taller than
 *  a prompt, and two of them in one rank must not overlap. */
const ROW_GAP = 150

export interface Placed {
  id: string
  x: number
  y: number
}

/**
 * True when the flow's own coordinates are worth honouring.
 *
 * A single node at the origin is fine — one node cannot overlap itself. Several
 * nodes sharing `[0, 0]` is the default, not a layout, and must not be mistaken
 * for one: that is precisely the case that renders as a single stacked blob.
 */
export function hasAuthoredLayout(nodes: FlowNode[]): boolean {
  if (nodes.length < 2) return true
  const seen = new Set<string>()
  for (const n of nodes) {
    const [x, y] = n.position ?? [0, 0]
    const key = `${x},${y}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

/**
 * Rank every node by its distance from the entry, then stack the ranks.
 *
 * Breadth-first from the entry node, with a visited set — the spec allows cycles
 * (§4.1) and a naive walk would not terminate. Nodes the entry cannot reach are
 * still placed: the spec says a visual editor may legitimately hold disconnected
 * scratch nodes, and a node that cannot be seen cannot be reconnected.
 */
export function layout(def: FlowDefinition): Map<string, Placed> {
  const nodes = def.nodes ?? []
  const edges = def.edges ?? []
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const out = new Map<string, FlowEdge[]>()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    const list = out.get(e.source)
    if (list) list.push(e)
    else out.set(e.source, [e])
  }

  const rank = new Map<string, number>()
  const entry = nodes.find((n) => n.node_type === 'entry') ?? nodes[0]
  if (entry) {
    const queue: Array<[string, number]> = [[entry.id, 0]]
    rank.set(entry.id, 0)
    while (queue.length > 0) {
      const [id, depth] = queue.shift() as [string, number]
      for (const edge of out.get(id) ?? []) {
        // First visit wins, which keeps a cycle from pushing a node ever
        // rightward and keeps the walk finite.
        if (rank.has(edge.target)) continue
        rank.set(edge.target, depth + 1)
        queue.push([edge.target, depth + 1])
      }
    }
  }

  // Unreachable nodes go in a rank past everything placed, so they read as
  // "off to the side" rather than being interleaved with the real path.
  const reachedMax = rank.size > 0 ? Math.max(...rank.values()) : -1
  for (const n of nodes) {
    if (!rank.has(n.id)) rank.set(n.id, reachedMax + 1)
  }

  const rows = new Map<number, string[]>()
  // Iterate `nodes`, not `rank`, so ordering within a rank follows document
  // order — stable across reloads, where a Map's insertion order would follow
  // whatever the traversal happened to do.
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0
    const row = rows.get(r)
    if (row) row.push(n.id)
    else rows.set(r, [n.id])
  }

  const placed = new Map<string, Placed>()
  for (const [r, ids] of rows) {
    // Centre each rank on y=0 so a straight-line flow renders as a straight
    // line rather than drifting downward.
    const offset = ((ids.length - 1) * ROW_GAP) / 2
    ids.forEach((id, i) => {
      placed.set(id, { id, x: r * RANK_GAP, y: i * ROW_GAP - offset })
    })
  }
  return placed
}

/**
 * The coordinates to draw with: the flow's own when it has real ones, computed
 * otherwise.
 *
 * Returned separately rather than written back into the nodes, because a
 * computed layout must never be mistaken for an authored one. Persisting it
 * would rewrite `position` on every flow anyone merely *looked at*, turning a
 * read into a diff in whatever git repo the flow is tracked in.
 */
export function positions(def: FlowDefinition): Map<string, Placed> {
  const nodes = def.nodes ?? []
  if (hasAuthoredLayout(nodes)) {
    return new Map(
      nodes.map((n) => {
        const [x, y] = n.position ?? [0, 0]
        return [n.id, { id: n.id, x, y }]
      }),
    )
  }
  return layout(def)
}
