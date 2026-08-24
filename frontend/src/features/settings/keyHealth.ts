import type { ConnectionStatus } from '@/types'

/**
 * What the card should say about the key, given what the core found.
 *
 * A pure function so the interesting part — *when does a connection stop
 * counting as working* — can be tested against a clock instead of a rendered
 * component. The judgement is here rather than in the core for one reason: only
 * this side knows what time it is where the person is.
 */
export interface KeyVerdict {
  /** `fine` puts nothing on screen. The rest are increasingly loud. */
  tone: 'fine' | 'quiet' | 'warn' | 'bad'
  text?: string
  /**
   * The connection is not working, whatever the pod holds.
   *
   * The chip reads from this, because "Connected · 26 tools installed" over a
   * revoked key is the exact lie this whole check exists to stop telling.
   */
  broken: boolean
}

/** Close enough to matter. Long enough to still be doing something about it. */
const SOON_DAYS = 14
const DAY_MS = 86_400_000

const fine: KeyVerdict = { tone: 'fine', broken: false }

/** A date a person recognises, in their own locale, or null if it is not one. */
function on(iso: string): string | null {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? null
    : at.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function judgeKey(status: ConnectionStatus | null, now = Date.now()): KeyVerdict {
  // No key is not a broken key: "Not connected" is already the whole story, and
  // a second sentence saying the same thing is noise on the one card someone
  // reads when nothing is wrong.
  if (!status?.key_present) return fine

  const health = status.key_health
  if (!health) return fine

  if (health.state === 'gone') {
    return {
      tone: 'bad',
      broken: true,
      text: 'This key was revoked — the service no longer has it, so every tool in the pack will fail. Reconnect to mint a new one.',
    }
  }

  if (health.state === 'unchecked') {
    // Deliberately quiet. Nothing is known to be wrong; the point is only that
    // "we could not check" must not read as "checked, and fine".
    return { tone: 'quiet', broken: false, text: `Not verified — ${health.why}.` }
  }

  if (!health.expires_at) return fine

  const at = new Date(health.expires_at).getTime()
  if (Number.isNaN(at)) {
    // The service sent something, and it is not a date. Say so rather than
    // silently treating an unreadable expiry as no expiry.
    return {
      tone: 'quiet',
      broken: false,
      text: `The service reports an expiry this app cannot read: ${health.expires_at}.`,
    }
  }

  if (at <= now) {
    return {
      tone: 'bad',
      broken: true,
      text: `This key expired on ${on(health.expires_at)} — every tool in the pack will fail until it is replaced. Reconnect to mint a new one.`,
    }
  }

  const days = Math.ceil((at - now) / DAY_MS)
  const when = `${on(health.expires_at)} (${days === 1 ? 'tomorrow' : `in ${days} days`})`
  return days <= SOON_DAYS
    ? { tone: 'warn', broken: false, text: `This key expires on ${when}. Reconnect to replace it before it does.` }
    : { tone: 'quiet', broken: false, text: `This key expires on ${when}.` }
}
