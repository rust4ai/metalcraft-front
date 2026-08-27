import type { FlowEdge, FlowNode, SavedFlow } from '@/types'

/**
 * Editing a flow, as pure functions over the document.
 *
 * **Every operation patches; nothing is rebuilt.** A node is always produced by
 * spreading the node that was there (`{ ...node, position }`), never by
 * constructing a fresh object from the fields this build knows about. That is
 * not a style preference — it is the only thing standing between an editor and
 * silently deleting what it does not understand.
 *
 * The flow spec requires a vendor node's `data` to round-trip verbatim (§5.2),
 * and a pod one version ahead of this app may put fields on a node or on the
 * document that this build has never heard of. Spreading keeps both for free.
 * Rebuilding would drop them on the first save, for everyone who has not
 * updated, with no error anywhere. The iOS client cannot do this — a fixed-field
 * `Codable` struct has already forgotten by the time you hold it — which is
 * exactly why it is worth being deliberate about here, where it is achievable.
 */

/** A node id that is not already taken, derived from the type so it reads. */
export function freshNodeId(flow: SavedFlow, nodeType: string): string {
  const base = nodeType.split(':').at(-1) ?? nodeType
  const taken = new Set(flow.flow.nodes.map((n) => n.id))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

function freshEdgeId(flow: SavedFlow, source: string, target: string): string {
  const taken = new Set(flow.flow.edges.map((e) => e.id))
  const base = `${source}-${target}`
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Replace the graph, keeping every other field of the document. */
function withGraph(flow: SavedFlow, nodes: FlowNode[], edges: FlowEdge[]): SavedFlow {
  return { ...flow, flow: { ...flow.flow, nodes, edges } }
}

export function addNode(flow: SavedFlow, nodeType: string, at: [number, number]): SavedFlow {
  const node: FlowNode = {
    id: freshNodeId(flow, nodeType),
    node_type: nodeType,
    data: {},
    position: at,
  }
  return withGraph(flow, [...flow.flow.nodes, node], flow.flow.edges)
}

/**
 * Move a node.
 *
 * The one edit that happens constantly and means nothing, so it spreads rather
 * than reconstructs like all the others — a drag must not be the thing that
 * quietly strips a field off a vendor node.
 */
export function moveNode(flow: SavedFlow, id: string, to: [number, number]): SavedFlow {
  return withGraph(
    flow,
    flow.flow.nodes.map((n) => (n.id === id ? { ...n, position: to } : n)),
    flow.flow.edges,
  )
}

/** Merge keys into a node's `data`, keeping the keys already there. */
export function editNodeData(
  flow: SavedFlow,
  id: string,
  patch: Record<string, unknown>,
): SavedFlow {
  return withGraph(
    flow,
    flow.flow.nodes.map((n) =>
      n.id === id
        ? { ...n, data: { ...(n.data as Record<string, unknown> | null), ...patch } }
        : n,
    ),
    flow.flow.edges,
  )
}

/**
 * Rename a node, carrying every edge that pointed at it.
 *
 * A rename that left the edges behind would not read as a bug — it would read
 * as the graph falling apart, since the old id is a dangling reference the pod
 * refuses to save and nothing on screen explains.
 */
export function renameNode(flow: SavedFlow, from: string, to: string): SavedFlow {
  if (from === to || !to) return flow
  if (flow.flow.nodes.some((n) => n.id === to)) return flow
  return withGraph(
    flow,
    flow.flow.nodes.map((n) => (n.id === from ? { ...n, id: to } : n)),
    flow.flow.edges.map((e) => ({
      ...e,
      source: e.source === from ? to : e.source,
      target: e.target === from ? to : e.target,
    })),
  )
}

/** Delete a node and every edge touching it. */
export function deleteNode(flow: SavedFlow, id: string): SavedFlow {
  return withGraph(
    flow,
    flow.flow.nodes.filter((n) => n.id !== id),
    flow.flow.edges.filter((e) => e.source !== id && e.target !== id),
  )
}

/**
 * Connect two nodes.
 *
 * Refuses a duplicate — same source, target and handle — because a second
 * identical arc changes nothing about the run and is invisible on the canvas,
 * so it can only ever be an accident of dragging.
 */
export function connect(
  flow: SavedFlow,
  source: string,
  target: string,
  handle?: string,
): SavedFlow {
  const ids = new Set(flow.flow.nodes.map((n) => n.id))
  if (!ids.has(source) || !ids.has(target)) return flow
  const already = flow.flow.edges.some(
    (e) => e.source === source && e.target === target && (e.source_handle ?? null) === (handle ?? null),
  )
  if (already) return flow
  const edge: FlowEdge = {
    id: freshEdgeId(flow, source, target),
    source,
    target,
    ...(handle ? { source_handle: handle } : {}),
  }
  return withGraph(flow, flow.flow.nodes, [...flow.flow.edges, edge])
}

export function deleteEdge(flow: SavedFlow, id: string): SavedFlow {
  return withGraph(
    flow,
    flow.flow.nodes,
    flow.flow.edges.filter((e) => e.id !== id),
  )
}

/** Set (or clear, with `undefined`) which output an edge leaves from. */
export function setEdgeHandle(flow: SavedFlow, id: string, handle?: string): SavedFlow {
  return withGraph(
    flow,
    flow.flow.nodes,
    flow.flow.edges.map((e) => {
      if (e.id !== id) return e
      const { source_handle: _dropped, ...rest } = e
      return handle ? { ...rest, source_handle: handle } : rest
    }),
  )
}

/**
 * Problems worth reporting before the pod is asked.
 *
 * Not a reimplementation of the pod's validator, which stays the authority and
 * runs again on save. These are the few that can be answered instantly, so the
 * canvas can react while someone is still dragging rather than after a
 * round trip.
 */
export function localProblems(flow: SavedFlow): string[] {
  const problems: string[] = []
  const nodes = flow.flow.nodes

  const entries = nodes.filter((n) => n.node_type === 'entry')
  if (entries.length > 1) {
    problems.push(`${entries.length} entry nodes — a flow may have at most one.`)
  }

  const seen = new Set<string>()
  for (const n of nodes) {
    if (seen.has(n.id)) problems.push(`Two nodes share the id "${n.id}".`)
    seen.add(n.id)
  }

  for (const e of flow.flow.edges) {
    if (!seen.has(e.source)) problems.push(`An edge starts at "${e.source}", which is not a step.`)
    if (!seen.has(e.target)) problems.push(`An edge points at "${e.target}", which is not a step.`)
  }

  return problems
}

/**
 * An undo stack that keeps whole documents.
 *
 * Snapshots rather than inverse operations: a flow is small, the operations
 * above are already immutable, and "undo" that has to reconstruct the past from
 * a log is where undo bugs live.
 */
export interface History {
  past: SavedFlow[]
  present: SavedFlow
  future: SavedFlow[]
}

/** How many steps back undo reaches. Past this, the oldest is forgotten. */
const DEPTH = 50

export const historyOf = (flow: SavedFlow): History => ({ past: [], present: flow, future: [] })

export function apply(history: History, next: SavedFlow): History {
  if (next === history.present) return history
  return {
    past: [...history.past, history.present].slice(-DEPTH),
    present: next,
    // A new edit abandons the redo branch — keeping it would offer a future
    // that no longer follows from the present.
    future: [],
  }
}

export function undo(history: History): History {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo(history: History): History {
  const [next, ...rest] = history.future
  if (!next) return history
  return { past: [...history.past, history.present], present: next, future: rest }
}
