import type { AgentInstance } from '@/types'

/**
 * How long an agent can go without a chat or an update before it drops out of
 * the working set and into Agent History.
 *
 * History is a shelf, not a bin: nothing is deleted, nothing is hidden from
 * search, and one message puts an agent straight back at the top of the live
 * list. Three days is the point where a fleet someone actually uses stops being
 * an index of "what I am working with" and starts being an archive of
 * everything they ever spawned.
 */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

/**
 * When this agent last did anything, or null if the pod gave us nothing we can
 * date. Creation counts — an agent spawned a minute ago and never chatted with
 * is new, not stale, and shelving it would hide the one someone just made.
 */
export function lastActivity(instance: AgentInstance): number | null {
  const iso = instance.last_active_at || instance.created_at
  if (!iso) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

/** An undateable agent is never stale: a missing timestamp is our problem, and
 *  the cost of guessing wrong is an agent someone uses every day sitting under
 *  a collapsed "History" heading. */
export function isStale(instance: AgentInstance, now = Date.now()): boolean {
  const at = lastActivity(instance)
  return at !== null && now - at > STALE_AFTER_MS
}

export interface FleetPartition {
  /** Touched within the window — the fleet as it is normally shown. */
  active: AgentInstance[]
  /** Untouched for longer, most recently active first. */
  history: AgentInstance[]
}

/**
 * Split a fleet into the working set and the shelf.
 *
 * `active` keeps the order it was given, so the main list does not reshuffle
 * itself as agents age out; `history` is sorted newest-first, because the only
 * question anyone asks of an archive is "what was I doing most recently".
 */
export function partitionByActivity(
  instances: AgentInstance[],
  now = Date.now(),
): FleetPartition {
  const active: AgentInstance[] = []
  const history: AgentInstance[] = []
  for (const instance of instances) {
    if (isStale(instance, now)) history.push(instance)
    else active.push(instance)
  }
  history.sort((a, b) => (lastActivity(b) ?? 0) - (lastActivity(a) ?? 0))
  return { active, history }
}

/**
 * `4m`, `3h`, `12d` — an age for a column, not a sentence.
 *
 * The rail says "5h ago" because it is read as prose. A right-aligned column in
 * a list of thirty rows is scanned rather than read, and the repeated "ago" is
 * thirty copies of a word that carries nothing. Empty rather than a guess when
 * the pod gave us nothing datable, so the column stays blank instead of
 * inventing an age.
 */
export function shortAge(instance: AgentInstance, now = Date.now()): string {
  const at = lastActivity(instance)
  if (at === null) return ''
  const secs = Math.max(0, (now - at) / 1000)
  if (secs < 60) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86_400)}d`
}

/** The letter on an agent's tile. Falls back to the preset when the name starts
 *  with something unletterable, and to a dot when neither offers one. */
export function monogram(instance: AgentInstance): string {
  const from = `${instance.name ?? ''}${instance.agent_preset ?? ''}`
  const letter = [...from].find((c) => /\p{L}|\p{N}/u.test(c))
  return (letter ?? '·').toUpperCase()
}
