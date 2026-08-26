import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const HIT = {
  reference: 'axoniac:@amy_kitchen',
  id: 'amy_kitchen',
  name: 'Amy',
  tagline: 'Knows every flavor you have ever made.',
  tags: ['cooking'],
  verified: true,
  version: '1.2.0',
  install_count: 412,
}

async function mount(over: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: { method: string; args?: Record<string, unknown> }[] = []
  const responses: Record<string, unknown> = {
    list_registries: {
      origins: ['https://axoniac.com'],
      default: 'axoniac',
      registries: [
        { name: 'axoniac', url: 'https://axoniac.com', is_default: true },
        { name: 'metalcraft', url: 'https://packs.metalcraftai.com', is_default: false },
      ],
    },
    list_installed_packs: [],
    registry_status: { registry: 'axoniac', url: 'https://axoniac.com', state: 'no_token' },
    registry_search: [HIT],
    install_pack: {},
    list_instances: [],
    list_presets: [],
    ...over,
  }
  const transport: Transport = {
    call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args })
      if (!(method in responses)) throw new Error(`unstubbed: ${method}`)
      const stub = responses[method]
      // A stub may depend on what it was asked — the update sweep searches per
      // installed pack, and the point of it is that those results differ from the
      // page the tab opened on.
      const value = typeof stub === 'function' ? (stub as (a?: Record<string, unknown>) => unknown)(args) : stub
      if (value instanceof Error) throw value
      return value as never
    }),
    listen: vi.fn(async () => () => {}),
  }
  const t = await import('@/rpc/transport')
  t.setTransport(transport)
  const { PacksView } = await import('./PacksView')
  render(<PacksView />)
  return { calls }
}

describe('PacksView', () => {
  it('lists the registries the pod will fetch from, and their packs', async () => {
    // The roster comes from the pod, never hardcoded: a host the pod would refuse
    // must not appear here with an install button.
    await mount()
    await waitFor(() => expect(screen.getByText('Amy')).toBeTruthy())
    expect(screen.getByText('axoniac')).toBeTruthy()
    expect(screen.getByText('metalcraft')).toBeTruthy()
    expect(screen.getByText('axoniac:@amy_kitchen')).toBeTruthy()
  })

  it('says anonymous browsing is fine and offers to connect', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('Browsing anonymously')).toBeTruthy())
    expect(screen.getByText('Connect this pod')).toBeTruthy()
  })

  it('points at the host’s own link when the pod is unlinked', async () => {
    await mount({
      registry_status: {
        registry: 'axoniac',
        url: 'https://axoniac.com',
        state: 'unlinked',
        link_url: 'https://axoniac.com/link/abc',
      },
    })
    await waitFor(() => expect(screen.getByText('Not linked yet')).toBeTruthy())
    const link = screen.getByRole('link', { name: /finish linking/i })
    expect(link.getAttribute('href')).toBe('https://axoniac.com/link/abc')
    // Connecting would not help here, so it is not offered.
    expect(screen.queryByText('Connect this pod')).toBeNull()
  })

  it('installs by qualified reference and re-reads what the pod has', async () => {
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByText('Amy')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /install/i }))
    await waitFor(() => {
      const install = calls.find((c) => c.method === 'install_pack')
      expect(install?.args).toMatchObject({ reference: 'axoniac:@amy_kitchen', allowUnverified: false })
    })
    // Two reads of the installed list: once on load, once after installing —
    // the pod is the authority on what it now has.
    expect(calls.filter((c) => c.method === 'list_installed_packs')).toHaveLength(2)
  })

  it('warns before install when a verified-only pod would refuse the pack', async () => {
    await mount({
      registry_status: {
        registry: 'axoniac',
        url: 'https://axoniac.com',
        state: 'no_token',
        trust: 'verified-only',
      },
      registry_search: [{ ...HIT, verified: false }],
    })
    await waitFor(() => expect(screen.getByText('Install unverified')).toBeTruthy())
  })

  it('shows an already-installed pack as installed, not as an install button', async () => {
    await mount({ list_installed_packs: [{ id: 'amy_kitchen', version: '1.2.0', presets: ['amy'] }] })
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^install$/i })).toBeNull()
  })

  it('offers an update, in both versions, when the host has a newer one', async () => {
    await mount({ list_installed_packs: [{ id: 'amy_kitchen', version: '1.0.0', presets: ['amy'] }] })
    await waitFor(() => expect(screen.getByRole('button', { name: /Update to 1\.2\.0/ })).toBeTruthy())
    // Both numbers: "update" says nothing without what you are updating from.
    expect(screen.getByText(/v1\.0\.0 → v1\.2\.0/)).toBeTruthy()
    expect(screen.getByText(/1 update$/)).toBeTruthy()
  })

  it('does not offer an update when the host is behind the pod', async () => {
    // The pod refuses a downgrade, so this button could only ever produce an error.
    await mount({ list_installed_packs: [{ id: 'amy_kitchen', version: '2.0.0', presets: ['amy'] }] })
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('finds an update to a pack the current page never showed', async () => {
    // Browsing lists a page of the catalogue. A pack installed from this host but
    // outside that page was invisible, and so was any update to it — which is the
    // case that matters, because it is the pack you actually run.
    const offPage = { ...HIT, reference: 'axoniac:@buildrspace', id: 'buildrspace', name: 'buildr.space', version: '0.2.0' }
    const { calls } = await mount({
      list_installed_packs: [{ id: 'buildr-space', version: '0.1.1', presets: ['buildr-space'] }],
      // The catalogue page is empty; the pack only turns up when asked for by name.
      registry_search: (args?: Record<string, unknown>) => (args?.query ? [offPage] : []),
    })
    // No click: the sweep runs when the registry opens, because a button nobody
    // presses is not detection.
    await waitFor(() => expect(screen.getByText('Installed, and newer here')).toBeTruthy())
    expect(screen.getByText(/nothing to show yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Update to 0\.2\.0/ })).toBeTruthy()
    // Asked by the id the POD holds, which is the only name it knows.
    expect(calls.some((c) => c.method === 'registry_search' && c.args?.query === 'buildr-space')).toBe(true)
  })

  it('names the real problem when the pod predates the registry proxy', async () => {
    // The tab still lists axoniac — a pod knows its hosts long before it can
    // browse them — so the only clue is a bodyless 404 under the proxy path.
    await mount({
      registry_status: new Error('404 Not Found /agent-packs/registries/axoniac/status: '),
      registry_search: new Error('404 Not Found /agent-packs/registries/axoniac/search?limit=50: '),
    })
    await waitFor(() => expect(screen.getByText(/too old to browse axoniac/)).toBeTruthy())
    // And it must not also claim the catalogue is merely empty.
    expect(screen.queryByText(/nothing to show yet/)).toBeNull()
  })
})
