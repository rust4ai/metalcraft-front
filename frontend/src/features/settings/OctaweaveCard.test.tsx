import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const disconnected = { key_present: false, pack_installed: false, pack_enabled: false, api_tools: 0 }
const connected = { key_present: true, pack_installed: true, pack_enabled: true, api_tools: 32, pack_version: '1.0.0' }

async function mount(overrides: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: { method: string; args: unknown }[] = []
  let emit: ((token: string) => void) | undefined

  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string, args: unknown) => {
      calls.push({ method, args })
      if (method in overrides) {
        const r = overrides[method]
        if (r instanceof Error) throw r
        return r as never
      }
      if (method === 'octaweave_status') return disconnected as never
      if (method === 'list_keys') return [] as never
      return undefined as never
    }),
    listen: vi.fn(async (_channel: string, cb: (v: never) => void) => {
      emit = cb as (t: string) => void
      return () => {}
    }),
  } as Transport)

  const { OctaweaveCard } = await import('./OctaweaveCard')
  render(<OctaweaveCard />)
  return { calls, fireToken: (tok: string) => emit?.(tok) }
}

const connection = {
  workspace_id: 'ws_1',
  label: 'My workspace',
  scopes: ['notes:write', 'board:write'],
  is_admin: false,
  status: connected,
  pack_error: null,
}

describe('OctaweaveCard', () => {
  it('offers the browser hand-off when nothing is connected', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Open Octaweave/ })).toBeTruthy()
  })

  it('connects in one action and shows the workspace it proved', async () => {
    const { calls } = await mount({ octaweave_connect: connection })
    await userEvent.type(await screen.findByLabelText('Octaweave key'), 'owk_live_x')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(screen.getByText('My workspace')).toBeTruthy())
    expect(screen.getByText('notes:write board:write')).toBeTruthy()
    expect(screen.getByText(/32 tools installed/)).toBeTruthy()
    // One call does verify → store → install; the renderer never touches keys.
    expect(calls.filter((c) => c.method === 'octaweave_connect').length).toBe(1)
    expect(calls.some((c) => c.method === 'save_key')).toBe(false)
  })

  it('names the halfway state when the key stored but the pack did not install', async () => {
    // Real and reachable today: the octaweave pack is not published, so the
    // install fails while the key is already safely stored. Reporting a clean
    // success would leave an agent with a credential and no tools.
    await mount({
      octaweave_connect: { ...connection, status: { ...connected, pack_installed: false, api_tools: 0 }, pack_error: "no version of 'octaweave' matches *" },
    })
    await userEvent.type(await screen.findByLabelText('Octaweave key'), 'owk_live_x')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(screen.getByText(/no version of 'octaweave' matches/)).toBeTruthy())
    expect(screen.getByText('Key only')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Install the tools/ })).toBeTruthy()
  })

  it('surfaces a key Octaweave rejects, without storing it', async () => {
    const { calls } = await mount({ octaweave_connect: new Error('Octaweave rejected that key') })
    await userEvent.type(await screen.findByLabelText('Octaweave key'), 'bad')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(screen.getByText(/rejected that key/)).toBeTruthy())
    expect(calls.some((c) => c.method === 'save_key')).toBe(false)
  })

  it('connects automatically when the browser returns a key', async () => {
    // The deep-link path and the paste path must be the same path — one place
    // verification happens.
    const { calls, fireToken } = await mount({ octaweave_connect: connection })
    await screen.findByLabelText('Octaweave key')
    fireToken('owk_live_from_browser')

    await waitFor(() => expect(screen.getByText('My workspace')).toBeTruthy())
    expect(calls.find((c) => c.method === 'octaweave_connect')?.args).toEqual({
      token: 'owk_live_from_browser',
    })
  })

  it('warns when the pack is installed but switched off', async () => {
    // Identical to "not installed" from inside a conversation, so it cannot be
    // reported as connected-and-fine.
    await mount({ octaweave_status: { ...connected, pack_enabled: false } })
    await waitFor(() => expect(screen.getByText(/disabled on the pod/)).toBeTruthy())
  })

  it('disconnects', async () => {
    const { calls } = await mount({ octaweave_status: connected, octaweave_disconnect: disconnected })
    await userEvent.click(await screen.findByRole('button', { name: /Disconnect/ }))
    expect(calls.some((c) => c.method === 'octaweave_disconnect')).toBe(true)
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })
})
