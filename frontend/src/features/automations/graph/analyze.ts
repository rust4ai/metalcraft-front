import { look } from './nodeKinds'
import type { FlowDefinition } from '@/types'

/**
 * Nodes whose `error` output goes nowhere.
 *
 * Worth its own function, and worth showing on the canvas, because it is the
 * single most consequential thing about a graph that is invisible in the JSON.
 * Per SPEC §5.4 every executable node has an `error` rail, wiring it is optional,
 * and **an unwired rail fails the whole run** when the node fails. So a flow that
 * looks complete can die at 3am at a node nobody thought could fail, and the only
 * evidence is an edge that was never drawn.
 *
 * Only nodes that actually have the rail are considered — a `set_variable`
 * cannot fail this way, and flagging it would train people to ignore the flag.
 */
export function unhandledErrorNodes(definition: FlowDefinition): Set<string> {
  const wired = new Set(
    (definition.edges ?? []).filter((e) => e.source_handle === 'error').map((e) => e.source),
  )
  const out = new Set<string>()
  for (const node of definition.nodes ?? []) {
    const handles = look(node.node_type).handles
    if (handles?.includes('error') && !wired.has(node.id)) out.add(node.id)
  }
  return out
}
