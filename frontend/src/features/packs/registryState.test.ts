import { describe, expect, it } from 'vitest'
import {
  blockedByTrust,
  canConnect,
  describeConnection,
  describeRegistryError,
  isInstalled,
  updateAvailable,
  compareVersions,
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

  it('reports both versions when the host has a newer one', () => {
    expect(updateAvailable(hit({ version: '1.1.0' }), installed)).toMatchObject({
      from: '1.0.0',
      to: '1.1.0',
    })
    expect(updateAvailable(hit({ version: '1.0.0' }), installed)).toBeNull()
    // Nothing to compare is not an update.
    expect(updateAvailable(hit(), installed)).toBeNull()
  })

  it('does not call an older version on the host an update', () => {
    // The pod refuses a downgrade outright, so offering one only ever produced a
    // button that promised an upgrade and delivered an error.
    const podHas: InstalledPack[] = [{ id: 'amy_kitchen', version: '0.2.0', presets: [] }]
    expect(updateAvailable(hit({ version: '0.1.1' }), podHas)).toBeNull()
  })

  it('names the id the POD filed the pack under, not the host handle', () => {
    // The update endpoint is keyed on the pod's id. Sending the handle would 404
    // for exactly the packs whose two names differ.
    const podHas: InstalledPack[] = [{ id: 'buildr-space', version: '0.1.0', presets: [] }]
    const listed = hit({ id: 'buildrspace', reference: 'axoniac:@buildrspace', version: '0.1.1' })
    expect(updateAvailable(listed, podHas, { 'axoniac:@buildrspace': 'buildr-space' })).toMatchObject({
      from: '0.1.0',
      to: '0.1.1',
      id: 'buildr-space',
    })
  })
})

describe('compareVersions', () => {
  it('reads versions as numbers, not as strings', () => {
    // The bug this exists for: '0.10.0' < '0.9.0' is true of strings and false of
    // versions, so a tenth release would have looked like a downgrade.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
  })

  it('treats a missing segment as zero rather than as smaller', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })

  it('orders a pre-release below the release it precedes', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.1')).toBe(1)
  })

  it('falls back to inequality for a version it cannot parse', () => {
    // An odd version scheme should still be updatable, just not ordered cleverly.
    expect(compareVersions('nightly', 'nightly')).toBe(0)
    expect(compareVersions('nightly-b', 'nightly-a')).toBe(1)
  })

  it('tolerates a leading v', () => {
    expect(compareVersions('v2.0.0', '1.9.9')).toBe(1)
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
