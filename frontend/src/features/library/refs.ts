/**
 * What the library can point at, and how a pointer is spelled.
 *
 * Every artifact on the pod references its neighbours **by name** — a preset's
 * `skills` is a list of slugs, a persona's `integrations` a list of ids. A
 * `Ref` is that string with the kind attached, which is the whole difference
 * between a library and a list: it is what lets a chip in one show page become
 * the address of another.
 *
 * Deliberately not a URL. The library is one tab with a trail inside it, so a
 * ref is a value that gets pushed onto a stack rather than a route that gets
 * parsed — no router, no history entries, and closing the tab forgets the trail
 * the way closing a tab should.
 */
export type ArtifactKind =
  | 'preset'
  | 'persona'
  | 'skill'
  | 'integration'
  | 'tool'
  | 'pack'
  | 'template'

export interface Ref {
  kind: ArtifactKind
  /** The pod's own identifier: a slug for most, a name for a tool, an id for a
   *  pack or an integration. Whatever the detail route takes. */
  id: string
}

/** Stable key for cache maps and React keys. Also what `Trail` compares on, so
 *  re-opening the artifact you are already looking at is a no-op. */
export function refKey(ref: Ref): string {
  return `${ref.kind}:${ref.id}`
}

export function sameRef(a: Ref, b: Ref): boolean {
  return a.kind === b.kind && a.id === b.id
}

/**
 * What a kind is called in the singular, and in a heading.
 *
 * "Agent" rather than "Preset" for the thing the pod calls `agent_preset`: the
 * rest of this app already made that choice (the packs tab is "Browse agent
 * presets" and its cards say Agents), and a library that renamed it would be
 * the only screen using the pod's word.
 */
export const KIND_LABEL: Record<ArtifactKind, { one: string; many: string }> = {
  preset: { one: 'Agent', many: 'Agents' },
  persona: { one: 'Persona', many: 'Personas' },
  skill: { one: 'Skill', many: 'Skills' },
  integration: { one: 'Integration', many: 'Integrations' },
  tool: { one: 'API tool', many: 'API tools' },
  pack: { one: 'Agent pack', many: 'Agent packs' },
  template: { one: 'Automation template', many: 'Automation templates' },
}

/**
 * The order the index reads in, which is not the order the pod stores things in.
 *
 * Presets first because that is what someone came to look at — an agent is the
 * thing you talk to, and everything below it is what an agent is made of, in
 * roughly the order you would discover it by opening one.
 */
export const KIND_ORDER: ArtifactKind[] = [
  'preset',
  'persona',
  'skill',
  'integration',
  'tool',
  'template',
  'pack',
]

/** Case-insensitive substring match across whatever text an artifact carries.
 *  Nulls are skipped rather than stringified — `"null"` matching a search for
 *  "nu" is the kind of bug a filter helper is written once to avoid. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => !!f && f.toLowerCase().includes(q))
}
