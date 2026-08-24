import { describe, expect, it } from 'vitest'
import {
  blockedByTrust,
  canConnect,
  describeConnection,
  describeRegistryError,
  isInstalled,
  updateAvailable,
} from './registryState'
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

  it('recognises a pack whose handle on the host is not its own id', () => {
    // The real case: Axoniac lists buildr.space as `@buildrspace`, its archive
    // calls itself `buildr-space`, and the pod files it under the archive's id.
    // Before this, the card offered Install forever and every press reinstalled.
    const podHas: InstalledPack[] = [{ id: 'buildr-space', version: '0.1.1', presets: ['buildr-space'] }]
    const listed = hit({ id: 'buildrspace', reference: 'axoniac:@buildrspace', version: '0.1.1' })

    // From the manifest or the install report, which is the pod's own word.
    expect(isInstalled(listed, podHas, { 'axoniac:@buildrspace': 'buildr-space' })).toBe(true)
    // And without one, so the card is right before anyone opens the sheet.
    expect(isInstalled(listed, podHas)).toBe(true)
  })

  it('does not call two genuinely different packs the same one', () => {
    const podHas: InstalledPack[] = [{ id: 'amy_kitchen', presets: [] }]
    expect(isInstalled(hit({ id: 'amy_garden', reference: 'axoniac:@amy_garden' }), podHas)).toBe(false)
  })

  it('reports the installed version only when it differs', () => {
    expect(updateAvailable(hit({ version: '1.1.0' }), installed)).toBe('1.0.0')
    expect(updateAvailable(hit({ version: '1.0.0' }), installed)).toBeNull()
    // Nothing to compare is not an update.
    expect(updateAvailable(hit(), installed)).toBeNull()
  })

  it('offers an update for a pack matched through its alias', () => {
    const podHas: InstalledPack[] = [{ id: 'buildr-space', version: '0.1.0', presets: [] }]
    const listed = hit({ id: 'buildrspace', reference: 'axoniac:@buildrspace', version: '0.1.1' })
    expect(updateAvailable(listed, podHas, { 'axoniac:@buildrspace': 'buildr-space' })).toBe('0.1.0')
  })
})

describe('describeRegistryError', () => {
  // What a pod built before the registry proxy answers: axum's own 404, which has
  // no body, so nothing follows the path.
  const routeMiss = '404 Not Found /agent-packs/registries/axoniac/search?limit=50: '

  it('reads a bodyless 404 on the proxy as a pod that is too old', () => {
    const said = describeRegistryError(routeMiss, 'axoniac')
    expect(said).toMatch(/too old to browse axoniac/)
    expect(said).toMatch(/0\.30\.0/)
  })

  it('sees through the Error wrapper the transport adds', () => {
    expect(describeRegistryError(new Error(routeMiss), 'axoniac')).toMatch(/too old/)
  })

  it('leaves a 404 the pod actually meant alone', () => {
    // The pod says "no such pack" with the same status. Its words are better than
    // a guess about the pod's age, and rewriting this one would be a lie.
    const real = "404 Not Found /agent-packs/registries/axoniac/packs/amy/manifest: 'amy' is not published on axoniac"
    expect(describeRegistryError(real, 'axoniac')).toBe(real)
  })

  it('leaves every other failure in the pod’s own words', () => {
    const unsupported =
      '501 Not Implemented /agent-packs/registries/metalcraft/search?limit=50: metalcraft does not offer search.'
    expect(describeRegistryError(unsupported, 'metalcraft')).toBe(unsupported)
    expect(describeRegistryError('502 Bad Gateway /agent-packs/registries/axoniac/search: down', 'axoniac')).toMatch(
      /^502/,
    )
    // A 404 from somewhere else entirely is not evidence about the proxy.
    expect(describeRegistryError('404 Not Found /chats/abc: ', 'axoniac')).toBe('404 Not Found /chats/abc: ')
  })
})
