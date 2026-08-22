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
 * Is this hit already on the pod?
 *
 * Matched on the bare id, not the qualified reference: the pod records where the
 * bytes came from, which may be a peer host serving the same pack, and showing
 * "Install" for something already installed is worse than the rare false match.
 */
export function isInstalled(hit: SearchHit, installed: InstalledPack[]): boolean {
  return installed.some((p) => p.id === hit.id || p.id === hit.reference)
}

/** Version on the pod, when it differs from what the host is offering. */
export function updateAvailable(hit: SearchHit, installed: InstalledPack[]): string | null {
  const mine = installed.find((p) => p.id === hit.id)
  if (!mine?.version || !hit.version) return null
  return mine.version === hit.version ? null : mine.version
}
