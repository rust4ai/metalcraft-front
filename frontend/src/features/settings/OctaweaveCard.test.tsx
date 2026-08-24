import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const disconnected = { key_present: false, pack_installed: false, pack_enabled: false, api_tools: 0 }
const connected = { key_present: true, pack_installed: true, pack_enabled: true, api_tools: 32, pack_version: '1.0.0' }

/**
 * `octaweave_connect` is a *sequence* in the interesting cases — needs_link, then
 * needs_link again, then connected — so an override may be an array that is
 * consumed one call at a time. The last entry sticks, which is what a poll that
 * never resolves looks like.
 */
async function mount(overrides: Record<string, unknown> = {}, pollMs = 1) {
  vi.resetModules()
  const calls: { method: string; args: unknown }[] = []
  const queues = new Map<string, unknown[]>()

  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string, args: unknown) => {
      calls.push({ method, args })
      if (method in overrides) {
        const spec = overrides[method]
        let r = spec
        if (Array.isArray(spec)) {
          const q = queues.get(method) ?? [...spec]
          queues.set(method, q)
          r = q.length > 1 ? q.shift() : q[0]
        }
        if (r instanceof Error) throw r
        return r as never
      }
      if (method === 'octaweave_status') return disconnected as never
      if (method === 'list_keys') return [] as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)

  // The store is module state; a fresh one per test, with a poll interval a test
  // can actually wait out.
  const { useSettings } = await import('@/stores/settings')
  const connect = useSettings.getState().connectOctaweave
  useSettings.setState({ connectOctaweave: (ws?: string) => connect(ws, pollMs) })

  const { OctaweaveCard } = await import('./OctaweaveCard')
  render(<OctaweaveCard />)
  return { calls }
}

const connection = {
  kind: 'connected',
  connection: {
    workspace_id: 'ws_1',
    label: 'My workspace',
    url: 'https://octaweave.com/acme/main',
    scopes: ['notes:write', 'board:write'],
    status: connected,
    pack_error: null,
    replaced: 0,
  },
}

const press = () => userEvent.click(screen.getByRole('button', { name: 'Connect Octaweave' }))

describe('OctaweaveCard', () => {
  it('asks for nothing but a click', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Connect Octaweave' })).toBeTruthy()
    // The paste flow is gone. A field here would mean the key crossed the webview.
    expect(screen.queryByLabelText('Octaweave key')).toBeNull()
  })

  it('connects in one action and shows the workspace it minted for', async () => {
    const { calls } = await mount({ octaweave_connect: connection })
    await press()

    await waitFor(() => expect(screen.getByText('My workspace')).toBeTruthy())
    expect(screen.getByText('notes:write board:write')).toBeTruthy()
    expect(screen.getByText(/32 tools installed/)).toBeTruthy()
    // One call does list → mint → verify → store → install, and the renderer
    // never touches the key store itself.
    expect(calls.filter((c) => c.method === 'octaweave_connect').length).toBe(1)
    expect(calls.some((c) => c.method === 'save_key')).toBe(false)
  })

  it('opens the browser once when the account is not linked, then finishes on its own', async () => {
    const { calls } = await mount({
      octaweave_connect: [
        { kind: 'needs_link', url: 'https://octaweave.com/link/metalcraft' },
        { kind: 'needs_link', url: 'https://octaweave.com/link/metalcraft' },
        connection,
      ],
      octaweave_link: 'https://octaweave.com/link/metalcraft',
    },
    // Slow enough that the waiting state is a state and not a frame — it is the
    // whole point of this test that something is shown while the user is away.
    120)
    await press()

    await waitFor(() => expect(screen.getByText(/Approve the connection in your browser/)).toBeTruthy())
    await waitFor(() => expect(screen.getByText('My workspace')).toBeTruthy())

    // The one thing polling must not do is open a tab per attempt.
    expect(calls.filter((c) => c.method === 'octaweave_link').length).toBe(1)
    expect(calls.filter((c) => c.method === 'octaweave_connect').length).toBeGreaterThan(1)
  })

  it('stops waiting when asked, and does not claim to be connected', async () => {
    await mount({
      octaweave_connect: { kind: 'needs_link', url: 'https://octaweave.com/link/metalcraft' },
      octaweave_link: 'https://octaweave.com/link/metalcraft',
    })
    await press()
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Octaweave' })).toBeTruthy())
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('lets the user pick when the account has more than one workspace', async () => {
    const { calls } = await mount({
      octaweave_connect: [
        {
          kind: 'choose_workspace',
          workspaces: [
            { id: 'ws_1', org_slug: 'acme', slug: 'main', name: 'My workspace', role: 'admin' },
            { id: 'ws_2', org_slug: 'acme', slug: 'side', name: 'Side project', role: 'admin' },
          ],
        },
        connection,
      ],
    })
    await press()

    await userEvent.click(await screen.findByRole('button', { name: /Side project/ }))
    await waitFor(() => expect(screen.getByText('My workspace')).toBeTruthy())
    // The pick is what the second call carries — the core is never left to guess.
    expect(calls.filter((c) => c.method === 'octaweave_connect').at(-1)?.args).toEqual({
      workspace: 'ws_2',
    })
  })

  it('names the halfway state when the key stored but the pack did not install', async () => {
    // Real and reachable today: the octaweave pack is not published, so the
    // install fails while the key is already safely stored. Reporting a clean
    // success would leave an agent with a credential and no tools.
    await mount({
      octaweave_connect: {
        kind: 'connected',
        connection: {
          ...connection.connection,
          status: { ...connected, pack_installed: false, api_tools: 0 },
          pack_error: "no version of 'octaweave' matches *",
        },
      },
    })
    await press()

    await waitFor(() => expect(screen.getByText(/no version of 'octaweave' matches/)).toBeTruthy())
    expect(screen.getByText('Key only')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Install the tools/ })).toBeTruthy()
  })

  it('says when reconnecting revoked the key it made before', async () => {
    await mount({
      octaweave_connect: {
        kind: 'connected',
        connection: { ...connection.connection, replaced: 1 },
      },
    })
    await press()
    await waitFor(() => expect(screen.getByText(/key this app made before was revoked/)).toBeTruthy())
  })

  it('surfaces a refusal without storing anything', async () => {
    const { calls } = await mount({
      octaweave_connect: new Error('you need admin on that workspace to create a key for it'),
    })
    await press()

    await waitFor(() => expect(screen.getByText(/you need admin on that workspace/)).toBeTruthy())
    expect(calls.some((c) => c.method === 'save_key')).toBe(false)
  })

  it('warns when the pack is installed but switched off', async () => {
    // Identical to "not installed" from inside a conversation, so it cannot be
    // reported as connected-and-fine.
    await mount({ octaweave_status: { ...connected, pack_enabled: false } })
    await waitFor(() => expect(screen.getByText(/disabled on the pod/)).toBeTruthy())
  })

  it('disconnects, and hands back the workspace so the key can be revoked there', async () => {
    const { calls } = await mount({
      octaweave_connect: connection,
      octaweave_disconnect: disconnected,
    })
    await press()
    await waitFor(() => expect(screen.getByText('My workspace')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: /Disconnect/ }))
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(calls.find((c) => c.method === 'octaweave_disconnect')?.args).toEqual({
      workspace: 'ws_1',
    })
  })
})
