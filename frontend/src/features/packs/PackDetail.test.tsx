import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const hit = {
  reference: 'axoniac:@amy_kitchen',
  id: 'amy_kitchen',
  name: 'Amy Kitchen',
  version: '1.2.0',
  tagline: 'cooks',
  tags: [],
  verified: true,
  install_count: 12,
}

const manifest = {
  id: 'amy_kitchen',
  name: 'Amy Kitchen',
  version: '1.2.0',
  description: 'A kitchen agent.',
  presets: ['chef'],
  provides: { personas: ['chef', 'baker'], skills: ['recipe'] },
  requires_env: [
    { name: 'OPENAI_API_KEY', needed_by: ['chef'], required: true },
    { name: 'SPOON_API_KEY', needed_by: ['recipe'], required: true },
    { name: 'NICE_TO_HAVE', needed_by: ['chef'], required: false },
  ],
  domains: ['api.spoonacular.com'],
}

async function mount(responses: Record<string, unknown>) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string) => {
      if (!(method in responses)) throw new Error(`unstubbed: ${method}`)
      const r = responses[method]
      if (r instanceof Error) throw r
      return r as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)
  const { usePacks } = await import('@/stores/packs')
  const { PackDetail } = await import('./PackDetail')
  usePacks.setState({ active: 'axoniac' })
  render(<PackDetail />)
  await usePacks.getState().view(hit as never)
  return usePacks
}

describe('PackDetail', () => {
  it('shows what the pack provides before it is installed', async () => {
    await mount({ registry_manifest: manifest, list_keys: [] })
    await waitFor(() => expect(screen.getByText('A kitchen agent.')).toBeTruthy())
    // "chef" is both a preset and a persona, so it legitimately appears twice.
    expect(screen.getAllByText('chef').length).toBe(2)
    expect(screen.getByText('baker')).toBeTruthy()
    expect(screen.getByText('recipe')).toBeTruthy()
    // Where it will reach is a pre-install fact, not a footnote.
    expect(screen.getByText('api.spoonacular.com')).toBeTruthy()
  })

  it('marks a required key the pod already has as met', async () => {
    await mount({
      registry_manifest: manifest,
      list_keys: [{ name: 'OPENAI_API_KEY', masked: 'sk-…', scope: 'global', managed: false }],
    })
    // One of the two required keys is still missing, so the warning counts one.
    await waitFor(() => expect(screen.getByText(/1 required key is not in this pod/)).toBeTruthy())
  })

  it('warns about every unmet required key before installing', async () => {
    // PLAN §9.4: an unmet requirement is a checklist item now, not a runtime
    // failure the first time someone talks to the agent.
    await mount({ registry_manifest: manifest, list_keys: [] })
    await waitFor(() => expect(screen.getByText(/2 required keys are not in this pod/)).toBeTruthy())
  })

  it('never counts an optional key as missing', async () => {
    // A pack that works better with a key it does not require must not look broken.
    await mount({ registry_manifest: manifest, list_keys: [] })
    await waitFor(() => expect(screen.getByText('NICE_TO_HAVE')).toBeTruthy())
    expect(screen.getByText('optional')).toBeTruthy()
    expect(screen.queryByText(/3 required/)).toBeNull()
  })

  it('reports a manifest the host will not serve', async () => {
    const store = await mount({ registry_manifest: new Error('boom'), list_keys: [] })
    await waitFor(() => expect(store.getState().manifestError[hit.reference]).toBeTruthy())
  })

  it('says Installed for a pack the pod filed under the archive\u2019s own id', async () => {
    // buildr.space: `@buildrspace` on the host, `buildr-space` in its manifest.
    // The sheet used to compare the handle with the pod's id and offer Install to
    // someone who had already installed it three times.
    const store = await mount({ registry_manifest: manifest, list_keys: [] })
    store.setState({
      // Same version as the hit: nothing to offer, so the sheet should settle on
      // "Installed" rather than on either button.
      installed: [{ id: 'buildr-space', version: hit.version, presets: ['buildr-space'] }],
      packIds: { 'axoniac:@buildrspace': 'buildr-space' },
      viewing: { ...hit, id: 'buildrspace', reference: 'axoniac:@buildrspace' } as never,
    })
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Install$/ })).toBeNull()
  })

  it('offers the update from the sheet, not just from the card behind it', async () => {
    // This sheet used to end at "✓ Installed" for anything already on the pod, so
    // opening a pack to read what a new version contains took away the button to
    // apply it. The one screen that explains the change was the one that could
    // not make it.
    const store = await mount({ registry_manifest: manifest, list_keys: [] })
    store.setState({
      installed: [{ id: 'amy_kitchen', version: '1.0.0', presets: ['chef'] }],
      viewing: hit as never,
    })
    const button = await screen.findByRole('button', { name: /Update to 1\.2\.0/ })
    expect(button).toBeTruthy()
    expect(screen.queryByText('Installed')).toBeNull()
  })

  it('updates through the pod’s update endpoint, never through install', async () => {
    // The whole bug: the button said Update and the call said install, so the pod
    // replaced the files and never reconciled the agents made from them.
    const calls: string[] = []
    vi.resetModules()
    const t = await import('@/rpc/transport')
    t.setTransport({
      call: vi.fn(async (method: string) => {
        calls.push(method)
        if (method === 'registry_manifest') return manifest as never
        if (method === 'list_keys') return [] as never
        if (method === 'update_pack')
          return {
            id: 'amy_kitchen',
            from_version: '1.0.0',
            to_version: '1.2.0',
            personas_fell_back: [],
            orphaned: [],
            memory_bases_repointed: [],
          } as never
        if (method === 'list_installed_packs')
          return [{ id: 'amy_kitchen', version: '1.2.0', presets: ['chef'] }] as never
        throw new Error(`unstubbed: ${method}`)
      }),
      listen: vi.fn(async () => () => {}),
    } as Transport)
    const { usePacks } = await import('@/stores/packs')
    const { PackDetail } = await import('./PackDetail')
    usePacks.setState({
      installed: [{ id: 'amy_kitchen', version: '1.0.0', presets: ['chef'] }],
      viewing: hit as never,
    })
    render(<PackDetail />)

    await userEvent.click(await screen.findByRole('button', { name: /Update to/ }))
    await waitFor(() => expect(calls).toContain('update_pack'))
    expect(calls).not.toContain('install_pack')
  })

  it('shows a failed install instead of going quiet', async () => {
    // The list's error line is behind this sheet's overlay, so a sheet that says
    // nothing is a press that looks like it did nothing.
    const store = await mount({
      registry_manifest: manifest,
      list_keys: [],
      install_pack: new Error('403 Forbidden: this pod takes verified packs only'),
    })
    await userEvent.click(await screen.findByRole('button', { name: /Install/ }))
    await waitFor(() => expect(screen.getByText(/takes verified packs only/)).toBeTruthy())
    expect(store.getState().installed).toEqual([])
  })

  it('closes without installing', async () => {
    const store = await mount({ registry_manifest: manifest, list_keys: [] })
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(store.getState().viewing).toBeNull()
  })
})

describe('what only the pod can answer', () => {
  it('warns when a preset collides with one already installed', async () => {
    // The registry describes a pack in isolation. Whether its presets collide
    // depends on what else is on *this* pod, so the answer can only come from
    // the pod opening the archive it would install.
    await mount({
      registry_manifest: manifest,
      list_keys: [],
      inspect_pack: { missing_env: [], preset_collisions: ['briefer'] },
    })
    await waitFor(() => expect(screen.getByText(/already provides/)).toBeTruthy())
    expect(screen.getByText('briefer')).toBeTruthy()
  })

  it('says nothing when the pod reports no collision', async () => {
    await mount({
      registry_manifest: manifest,
      list_keys: [],
      inspect_pack: { missing_env: [], preset_collisions: [] },
    })
    await waitFor(() => expect(screen.getByText(manifest.name)).toBeTruthy())
    expect(screen.queryByText(/already provides/)).toBeNull()
  })

  it('still shows the manifest when the pod refuses to inspect', async () => {
    // A `verified-only` pod declines an unvouched pack at inspect too. Losing
    // the whole sheet over that would leave nothing to decide from.
    await mount({
      registry_manifest: manifest,
      list_keys: [],
      inspect_pack: new Error('403 unverified'),
    })
    await waitFor(() => expect(screen.getByText(manifest.name)).toBeTruthy())
    expect(screen.queryByText(/already provides/)).toBeNull()
  })
})
