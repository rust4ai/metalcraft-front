import type { ConnectionState, InstalledPack, RegistryConnection, SearchHit } from '@/types'

/**
 * The judgements the packs UI makes, kept out of the components so they can be
 * tested and so the wording stays in one place.
 */

/** One line describing where the pod stands with a host, in the host's terms. */
export function describeConnection(c: RegistryConnection): {
  tone: 'good' | 'action' | 'neutral' | 'bad'
  label: string
  hint?: string
} {
  switch (c.state) {
    case 'connected':
      return { tone: 'good', label: c.account ? `Connected as ${c.account}` : 'Connected' }
    case 'unlinked':
      // The one state a button can fix, which is why it is not folded into
      // "rejected" — link_url is where that button goes.
      return { tone: 'action', label: 'Not linked yet', hint: c.detail ?? undefined }
    case 'no_token':
      return { tone: 'neutral', label: 'Browsing anonymously', hint: 'Public packs install fine.' }
    case 'rejected':
      return { tone: 'bad', label: 'This host refused the pod’s token', hint: c.detail ?? undefined }
    case 'unsupported':
      // Nothing is wrong: the registry contract is four endpoints and none of
      // them is `whoami`. There is simply nothing here to connect.
      return { tone: 'neutral', label: 'No sign-in on this host' }
    default:
      return { tone: 'neutral', label: 'Unknown state', hint: c.detail ?? undefined }
  }
}

/** Whether connecting is even a thing on this host, so the button can be absent
 *  rather than disabled with an explanation nobody asked for. */
export function canConnect(state: ConnectionState): boolean {
  return state === 'no_token' || state === 'rejected' || state === 'unknown'
}

/**
 * A pod set to `verified-only` will decline an unvouched pack with a 403. Knowing
 * that up front lets the button say so instead of producing an error the user has
 * to interpret.
 */
export function blockedByTrust(trust: string | null | undefined, verified: boolean): boolean {
  return (trust === 'verified-only' || trust === 'verified_only') && !verified
}

/**
 * The pack the pod has for this hit, if any.
 *
 * Harder than it looks, because a hit and an installed pack are named by two
 * different things. The registry lists a pack by its **handle** — the pod builds
 * the reference from `handle`, then `slug`, then the host's `id` — while the pod
 * records what it installed under the id in the pack's own `agent_pack.json`.
 * Those agree for most packs and diverge for real ones: Axoniac lists buildr.space
 * as `@buildrspace`, and the archive calls itself `buildr-space`, so a strict
 * comparison said "not installed" no matter how many times it was installed.
 *
 * Three ways to match, in descending order of authority:
 *
 *  1. `aliases` — the pack's own id, learned from its manifest or from the install
 *     report. The pod's own word, so it is exact.
 *  2. the hit's id or reference, for the packs whose two names do agree.
 *  3. ids that differ only in `-` and `_`, which is what makes the card right
 *     before anyone opens the sheet that would fetch the manifest.
 *
 * (3) can in principle match two packs that really are distinct. That trade was
 * already made here and is still the right way round: offering "Install" for
 * something already installed is the failure people actually hit.
 */
export function findInstalled(
  hit: SearchHit,
  installed: InstalledPack[],
  aliases?: Record<string, string>,
): InstalledPack | undefined {
  const own = aliases?.[hit.reference]
  const loose = squash(hit.id)
  return installed.find(
    (p) => p.id === own || p.id === hit.id || p.id === hit.reference || squash(p.id) === loose,
  )
}

/** Is this hit already on the pod? */
export function isInstalled(
  hit: SearchHit,
  installed: InstalledPack[],
  aliases?: Record<string, string>,
): boolean {
  return !!findInstalled(hit, installed, aliases)
}

/** Version on the pod, when it differs from what the host is offering. */
export function updateAvailable(
  hit: SearchHit,
  installed: InstalledPack[],
  aliases?: Record<string, string>,
): string | null {
  const mine = findInstalled(hit, installed, aliases)
  if (!mine?.version || !hit.version) return null
  return mine.version === hit.version ? null : mine.version
}

/** An id with its separators removed: `buildr-space`, `buildr_space` and
 *  `buildrspace` are one pack wearing three names. */
function squash(id: string): string {
  return id.replace(/[-_]/g, '')
}

/**
 * The version of metalcraft-agent that first served the registry proxy
 * (`registries/{name}/status`, `/search`, `/manifest` — agent `3a6ab9a`). The
 * plain `registries` list is older, which is what makes the failure confusing:
 * an out-of-date pod names its hosts perfectly well and then 404s every attempt
 * to browse one.
 */
export const REGISTRY_PROXY_SINCE = '0.30.0'

/**
 * Turn a failed proxy call into something a person can act on.
 *
 * The pod is careful about its own failures — 404 for a registry it does not
 * have, 501 for a host that is fetch-only, 502 for a host having a bad day — but
 * a route that does not *exist* is also a 404, and axum's is the same status as
 * the pod's own. Two things tell them apart. This UI only ever browses hosts the
 * pod itself listed, so "no such registry" cannot be true here; and axum answers
 * an unmatched route with an empty body, while every 404 the pod means carries
 * `{"error": …}` that reaches us as the detail after the path.
 *
 * Anything else is returned untouched: the pod's message about its own trouble is
 * better than one written here.
 */
export function describeRegistryError(error: unknown, registry: string): string {
  const message = String(error).replace(/^Error:\s*/, '')
  if (!isMissingProxy(message)) return message
  return (
    `This pod is too old to browse ${registry}. Browsing a registry needs ` +
    `metalcraft-agent ${REGISTRY_PROXY_SINCE} or newer — update the pod and try again.`
  )
}

function isMissingProxy(message: string): boolean {
  if (!/^404\b/.test(message)) return false
  const path = message.indexOf(' /agent-packs/registries/')
  if (path === -1) return false
  // Everything after the path is the pod's own words. A route miss has none.
  const detail = message.slice(path).split(':').slice(1).join(':')
  return detail.trim() === ''
}
