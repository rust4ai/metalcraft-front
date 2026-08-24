import { describe, expect, it } from 'vitest'
import { judgeKey } from './keyHealth'
import type { ConnectionStatus, KeyCheck } from '@/types'

const NOW = Date.parse('2026-08-24T12:00:00Z')
const day = 86_400_000

const status = (key_health?: KeyCheck | null, key_present = true): ConnectionStatus => ({
  key_present,
  pack_installed: true,
  pack_enabled: true,
  api_tools: 26,
  key_health,
})

describe('judgeKey', () => {
  it('says nothing when there is no key — "Not connected" is the whole story', () => {
    expect(judgeKey(status({ state: 'gone' }, false), NOW)).toEqual({ tone: 'fine', broken: false })
    expect(judgeKey(null, NOW).tone).toBe('fine')
  })

  it('says nothing for a service whose core does not check', () => {
    // Octaweave reports no health at all. Absent must read as "not asked", not
    // as "asked, and bad" — a card that grew a warning it cannot substantiate
    // is worse than one that stays quiet.
    expect(judgeKey(status(undefined), NOW).tone).toBe('fine')
    expect(judgeKey(status(null), NOW).broken).toBe(false)
  })

  it('says nothing for a live key with no expiry — the one this app mints', () => {
    expect(judgeKey(status({ state: 'live' }), NOW)).toEqual({ tone: 'fine', broken: false })
    expect(judgeKey(status({ state: 'live', expires_at: null }), NOW).tone).toBe('fine')
  })

  /**
   * The failure the whole check exists for. The pod still holds the key, the
   * pack is still installed, and every tool 401s — from here the two states are
   * indistinguishable without asking the service.
   */
  it('calls a revoked key broken, so the chip cannot say Connected', () => {
    const v = judgeKey(status({ state: 'gone' }), NOW)
    expect(v.broken).toBe(true)
    expect(v.tone).toBe('bad')
    expect(v.text).toMatch(/revoked/)
  })

  it('calls a lapsed key broken, and names the day it lapsed', () => {
    const at = new Date(NOW - 3 * day).toISOString()
    const v = judgeKey(status({ state: 'live', expires_at: at }), NOW)
    expect(v.broken).toBe(true)
    expect(v.text).toMatch(/expired on/)
  })

  it('warns before it lapses, and only once it is close', () => {
    const soon = judgeKey(status({ state: 'live', expires_at: new Date(NOW + 5 * day).toISOString() }), NOW)
    expect(soon.tone).toBe('warn')
    expect(soon.broken).toBe(false)
    expect(soon.text).toMatch(/in 5 days/)

    // Still true, still worth showing, not yet worth a colour.
    const far = judgeKey(status({ state: 'live', expires_at: new Date(NOW + 200 * day).toISOString() }), NOW)
    expect(far.tone).toBe('quiet')
    expect(far.broken).toBe(false)
    expect(far.text).toMatch(/in 200 days/)
  })

  it('says tomorrow rather than "in 1 days"', () => {
    const v = judgeKey(status({ state: 'live', expires_at: new Date(NOW + day).toISOString() }), NOW)
    expect(v.text).toMatch(/tomorrow/)
  })

  /**
   * "We could not ask" is a third answer, and the one a boolean would turn into
   * a lie. It is quiet — nothing is known to be wrong — but it is *said*.
   */
  it('does not let an unasked question read as a good answer', () => {
    const v = judgeKey(status({ state: 'unchecked', why: 'sign in to Metalcraft' }), NOW)
    expect(v.tone).toBe('quiet')
    expect(v.broken).toBe(false)
    expect(v.text).toMatch(/Not verified — sign in to Metalcraft/)
  })

  it('reports an unreadable expiry rather than treating it as none', () => {
    const v = judgeKey(status({ state: 'live', expires_at: 'whenever' }), NOW)
    expect(v.tone).toBe('quiet')
    expect(v.text).toMatch(/cannot read: whenever/)
  })
})
