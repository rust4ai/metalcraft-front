import type { SavedFlow } from '@/types'

/**
 * Starting a flow.
 *
 * The builder can edit any flow the pod holds, but until this it could not make
 * one — which left "create an automation" where it has always been: hand-written
 * JSON, or asking the agent to do it.
 */

/** Spec version a flow authored here declares. */
const SPEC_VERSION = '3'

/** `Morning Brief` → `morning-brief`, within `^[A-Za-z0-9-]{1,64}$`. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  // Not a fallback anyone should hit, but an empty id is a 400 from the pod and
  // "flow" is a better thing to be told to rename than nothing at all.
  return slug || 'flow'
}

/** An id nothing on this pod is using. */
export function freeFlowId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slugify(name)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`.slice(0, 64)
    if (!used.has(candidate)) return candidate
  }
}

/**
 * A new, empty flow — one entry node and nowhere to go yet.
 *
 * Not zero nodes: a flow with no entry is legal as a fragment (§5.3) but cannot
 * run, and handing someone an empty canvas whose first required step is
 * "discover that you need an `entry`" is a worse start than one step they can
 * see and connect to.
 */
export function blankFlow(name: string, takenIds: Iterable<string>, now: string): SavedFlow {
  return {
    spec_version: SPEC_VERSION,
    id: freeFlowId(name, takenIds),
    name,
    created_at: now,
    updated_at: now,
    flow: {
      nodes: [{ id: 'entry', node_type: 'entry', data: {}, position: [0, 0] }],
      edges: [],
    },
  }
}

/**
 * A copy of something that already exists — a template, or another flow.
 *
 * Spreads the source, so anything in it this build has never heard of comes
 * along: a template shipped by a pack a version ahead of this app is copied
 * whole, not reduced to the fields a `SavedFlow` type happens to name. Only
 * identity and timestamps are replaced, because those are the only things that
 * are genuinely about *this* copy rather than about the original.
 */
export function copyFlow(
  source: Record<string, unknown>,
  name: string,
  takenIds: Iterable<string>,
  now: string,
): SavedFlow {
  return {
    ...(source as unknown as SavedFlow),
    id: freeFlowId(name, takenIds),
    name,
    created_at: now,
    updated_at: now,
  }
}
