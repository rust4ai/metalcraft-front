import { describe, expect, it } from 'vitest'
import { blockedByTrust, canConnect, describeConnection, isInstalled, updateAvailable } from './registryState'
import type { InstalledPack, RegistryConnection, SearchHit } from '@/types'

const conn = (over: Partial<RegistryConnection>): RegistryConnection => ({
  registry: 'axoniac',
  url: 'https://axoniac.com',
  state: 'no_token',
  ...over,
})

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  reference: 'axoniac:@amy_kitchen',
  id: 'amy_kitchen',
  name: 'Amy',
  tags: [],
  verified: true,
  ...over,
})

describe('describeConnection', () => {
  it('names the account when the host knows it', () => {
    expect(describeConnection(conn({ state: 'connected', account: 'a@b.com' })).label).toBe(
      'Connected as a@b.com',
    )
  })

  it('treats unlinked as actionable, not as an error', () => {
    // It is the one state a button can fix; folding it into "rejected" would hide
    // the fix behind a message that sounds terminal.
    expect(describeConnection(conn({ state: 'unlinked' })).tone).toBe('action')
  })

  it('says anonymous browsing is fine rather than sounding broken', () => {
    const d = describeConnection(conn({ state: 'no_token' }))
    expect(d.tone).toBe('neutral')
    expect(d.hint).toMatch(/public packs/i)
  })

  it('shows the host’s own words when it refused', () => {
    const d = describeConnection(conn({ state: 'rejected', detail: 'token expired' }))
    expect(d.tone).toBe('bad')
    expect(d.hint).toBe('token expired')
  })

  it('does not call a host without sign-in broken', () => {
    expect(describeConnection(conn({ state: 'unsupported' })).tone).toBe('neutral')
  })
})

describe('canConnect', () => {
  it('offers connecting only where it would do something', () => {
    expect(canConnect('no_token')).toBe(true)
    expect(canConnect('rejected')).toBe(true)
    expect(canConnect('connected')).toBe(false)
    // A host with no identity endpoint has nothing to connect to.
    expect(canConnect('unsupported')).toBe(false)
  })
})

describe('blockedByTrust', () => {
  it('predicts the 403 a verified-only pod would return', () => {
    expect(blockedByTrust('verified-only', false)).toBe(true)
    expect(blockedByTrust('verified-only', true)).toBe(false)
    expect(blockedByTrust('any', false)).toBe(false)
  })
})

describe('installed state', () => {
  const installed: InstalledPack[] = [{ id: 'amy_kitchen', version: '1.0.0', presets: ['amy'] }]

  it('matches on the bare id, since the pod records where bytes came from', () => {
    expect(isInstalled(hit(), installed)).toBe(true)
    expect(isInstalled(hit({ id: 'other', reference: 'axoniac:@other' }), installed)).toBe(false)
  })

  it('reports the installed version only when it differs', () => {
    expect(updateAvailable(hit({ version: '1.1.0' }), installed)).toBe('1.0.0')
    expect(updateAvailable(hit({ version: '1.0.0' }), installed)).toBeNull()
    // Nothing to compare is not an update.
    expect(updateAvailable(hit(), installed)).toBeNull()
  })
})
