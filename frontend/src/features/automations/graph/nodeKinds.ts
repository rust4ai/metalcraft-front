import {
  Bot,
  Braces,
  CheckSquare,
  CircleDot,
  Clock,
  Flag,
  GitBranch,
  Globe,
  HelpCircle,
  Package,
  Repeat,
  Split,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * How each node type reads on the canvas.
 *
 * The grouping is by **what a node does to the run**, because that is what
 * someone scanning a graph is asking. Work is neutral, routing is where the path
 * splits, waiting is where the run stops being about the machine, and the
 * terminals bookend it. Colour follows the app's rule that agent-initiated
 * things are blue — so `prompt`, `branch` and `sub_agent`, the three that spend
 * an LLM call, are the blue ones.
 */
export type NodeKind = 'terminal' | 'work' | 'routing' | 'waiting' | 'unknown'

export interface NodeLook {
  label: string
  icon: LucideIcon
  kind: NodeKind
  /** Whether the node is one the model decides inside of. */
  thinks?: boolean
  /** Named output ports, in the order they should be drawn. `undefined` means a
   *  single unnamed output; `[]` means none at all. */
  handles?: string[]
  /** A one-line description of what this node's `data` is doing, given that data.
   *  Kept beside the look because both are "how do I read this node". */
  summary?: (data: Record<string, unknown>) => string | undefined
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** Clip to one line — a node card is not a place to read a prompt. */
const oneLine = (v: unknown, max = 90): string | undefined => {
  const s = str(v)
  if (!s) return undefined
  const flat = s.split(/\s+/).join(' ')
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

export const CORE_NODES: Record<string, NodeLook> = {
  entry: {
    label: 'Entry',
    icon: CircleDot,
    kind: 'terminal',
    summary: (d) => {
      const inputs = d.inputs
      if (inputs && typeof inputs === 'object') {
        const names = Object.keys(inputs as Record<string, unknown>)
        if (names.length > 0) return `takes ${names.join(', ')}`
      }
      return undefined
    },
  },
  prompt: {
    label: 'Prompt',
    icon: Sparkles,
    kind: 'work',
    thinks: true,
    handles: ['ok', 'error'],
    summary: (d) => oneLine(d.prompt),
  },
  conditional: {
    label: 'Conditional',
    icon: Split,
    kind: 'routing',
    summary: (d) => {
      const conditions = Array.isArray(d.conditions) ? d.conditions : []
      return conditions.length === 1 ? '1 condition' : `${conditions.length} conditions`
    },
  },
  branch: {
    label: 'Branch',
    icon: GitBranch,
    kind: 'routing',
    thinks: true,
    summary: (d) => oneLine(d.query),
  },
  set_variable: {
    label: 'Set',
    icon: Braces,
    kind: 'work',
    summary: (d) => {
      const name = str(d.variable)
      if (!name) return undefined
      const from = str(d.from)
      return from ? `${name} = ${from}` : `${name} = ${oneLine(d.value, 40) ?? '…'}`
    },
  },
  tool: {
    label: 'Tool',
    icon: Wrench,
    kind: 'work',
    handles: ['ok', 'error'],
    summary: (d) => str(d.tool_name),
  },
  http: {
    label: 'HTTP',
    icon: Globe,
    kind: 'work',
    handles: ['ok', 'error'],
    summary: (d) => {
      const url = str(d.url)
      const method = str(d.method)?.toUpperCase() ?? 'GET'
      return url ? `${method} ${oneLine(url, 60)}` : method
    },
  },
  sub_agent: {
    label: 'Sub-agent',
    icon: Bot,
    kind: 'work',
    thinks: true,
    handles: ['ok', 'error'],
    summary: (d) => oneLine(d.task),
  },
  approval: {
    label: 'Approval',
    icon: CheckSquare,
    kind: 'waiting',
    summary: (d) => oneLine(d.message),
  },
  wait: {
    label: 'Wait',
    icon: Clock,
    kind: 'waiting',
    summary: (d) => str(d.duration) ?? str(d.until),
  },
  foreach: {
    label: 'For each',
    icon: Repeat,
    kind: 'routing',
    summary: (d) => {
      const list = str(d.list)
      const mode = str(d.mode)
      return list ? `${list}${mode ? ` (${mode})` : ''}` : mode
    },
  },
  end: {
    label: 'End',
    icon: Flag,
    kind: 'terminal',
    handles: [],
    summary: (d) => str(d.status),
  },
  branch_tool: {
    label: 'Branch (legacy)',
    icon: GitBranch,
    kind: 'routing',
    summary: (d) => str(d.tool_name),
  },
}

/**
 * How to draw a node type, including ones this build has never heard of.
 *
 * Never returns undefined, and that is the point. A vendor type
 * (`slack:send_message`) is valid per SPEC §5.2 and must survive a round trip
 * untouched — a viewer that could not draw one would be telling someone their
 * flow is broken when the pod runs it happily. Unknown types get an honest card
 * that names what they are.
 */
export function look(nodeType: string): NodeLook {
  const core = CORE_NODES[nodeType]
  if (core) return core
  const colon = nodeType.indexOf(':')
  if (colon > 0) {
    return {
      label: nodeType.slice(colon + 1).replace(/_/g, ' '),
      icon: Package,
      kind: 'unknown',
    }
  }
  // Not a core type and not vendor-namespaced: a document from a newer spec than
  // this build. Say so rather than guessing.
  return { label: nodeType, icon: HelpCircle, kind: 'unknown' }
}

/**
 * The output handles a node can actually take, given its `data`.
 *
 * `look().handles` is the *fixed* vocabulary of a type (`ok`/`error`); a routing
 * node's handles are whatever its payload declares, which is why this reads the
 * data rather than a table. Used to offer an edge the handles its source can
 * emit — a `branch` whose outputs are declared but whose edges are unlabeled is
 * a flow the pod refuses, and the names are not guessable from the canvas.
 *
 * Advisory, never restrictive: an edge may carry a handle this build cannot
 * derive (a vendor node's, or one from a newer spec), and that handle is kept.
 */
const rows = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((r) => (r as Record<string, unknown> | null)?.handle)
    .filter((h): h is string => typeof h === 'string' && h.length > 0)

export function handlesOf(nodeType: string, data: Record<string, unknown>): string[] {
  const declared = ((): string[] => {
    switch (nodeType) {
      case 'branch':
        // `error` is reserved and always available, whether or not it is declared
        // (SPEC §5.4) — an unwired one fails the whole run, so it must be offerable.
        return [...rows(data.outputs), 'error']
      case 'conditional':
        return rows(data.conditions)
      case 'approval':
        return Array.isArray(data.choices)
          ? data.choices.filter((c): c is string => typeof c === 'string')
          : ['approve', 'reject']
      default:
        return look(nodeType).handles ?? []
    }
  })()

  const fallback = str(data.default_handle)
  return [...new Set([...declared, ...(fallback ? [fallback] : [])])]
}

/**
 * The source ports to draw on a card, as handle names — `null` being the
 * unnamed one.
 *
 * Binding an edge to a port is what makes a fork wirable by dragging, and it is
 * also the one thing that can make an edge *disappear*: React Flow drops an edge
 * whose `sourceHandle` matches no port on the node. So the ports are not just
 * what the node declares — they include every handle the node's own edges
 * already use, whoever wrote them. A vendor node's handle, a handle from a spec
 * newer than this build, a handle someone deleted from `outputs` but not from
 * the graph: each still gets a port, so the edge still has somewhere to land.
 */
export function portsOf(
  nodeType: string,
  data: Record<string, unknown>,
  edgeHandles: Array<string | null | undefined>,
): Array<string | null> {
  const named = [
    ...new Set([
      ...handlesOf(nodeType, data),
      ...edgeHandles.filter((h): h is string => typeof h === 'string' && h.length > 0),
    ]),
  ]
  // A terminal node has no outputs at all — unless the document says otherwise,
  // in which case drawing the port is how someone can see and remove the edge.
  if (look(nodeType).handles?.length === 0 && edgeHandles.length === 0) return []
  const unnamed = named.length === 0 || edgeHandles.some((h) => !h)
  return unnamed ? [...named, null] : named
}

/** The vendor prefix of a custom type, for the badge on its card. */
export function vendorOf(nodeType: string): string | undefined {
  const colon = nodeType.indexOf(':')
  return colon > 0 ? nodeType.slice(0, colon) : undefined
}

/** Tailwind classes per kind. Kept in one place so a card and its legend cannot
 *  drift apart. */
export const KIND_STYLES: Record<NodeKind, { ring: string; icon: string; chip: string }> = {
  terminal: { ring: 'border-line-strong', icon: 'text-ink-2', chip: 'bg-hover-2 text-ink-2' },
  work: { ring: 'border-line', icon: 'text-ink-2', chip: 'bg-hover text-ink-2' },
  routing: { ring: 'border-orange/40', icon: 'text-orange', chip: 'bg-orange-tint text-orange' },
  waiting: { ring: 'border-accent/40', icon: 'text-accent', chip: 'bg-accent-tint text-accent' },
  unknown: { ring: 'border-line border-dashed', icon: 'text-ink-3', chip: 'bg-hover text-ink-3' },
}
