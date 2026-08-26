import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'
import type { PackUpdateReport } from '@/types'

afterEach(cleanup)

const HIT = {
  reference: 'axoniac:@amy_kitchen',
  id: 'amy_kitchen',
  name: 'Amy',
  tags: [],
  verified: true,
  version: '2.0.0',
  install_count: 4,
}

const report: PackUpdateReport = {
  id: 'amy_kitchen',
  from_version: '1.0.0',
  to_version: '2.0.0',
  personas_fell_back: [
    { instance: 'inst-1', name: 'Kitchen', from: 'sous-chef', to: 'chef' },
  ],
  orphaned: [{ instance: 'inst-2', name: 'Bakery', agent_preset: 'baker', frozen: ['baker', 'recipe'] }],
  memory_bases_repointed: ['inst-1', 'inst-2'],
}

/** Mount the dialog over a store whose update returns `result`. */
async function mount(result: PackUpdateReport) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string) => {
      if (method === 'update_pack') return result as never
      if (method === 'list_installed_packs')
        return [{ id: 'amy_kitchen', version: result.to_version, presets: [] }] as never
      throw new Error(`unstubbed: ${method}`)
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)
  const { usePacks } = await import('@/stores/packs')
  const { UpdateReportDialog } = await import('./UpdateReportDialog')
  usePacks.setState({ installed: [{ id: 'amy_kitchen', version: '1.0.0', presets: [] }] })
  render(<UpdateReportDialog />)
  return usePacks
}

describe('UpdateReportDialog', () => {
  it('names every agent the update changed underneath the user', async () => {
    // The pod reconciles live agents on update and reports each one. Nothing read
    // that report before, so a persona could change on the agent someone talks to
    // daily with no trace outside an HTTP response nobody kept.
    const store = await mount(report)
    await store.getState().apply(HIT as never)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/v1\.0\.0/)).toBeTruthy()
    expect(screen.getByText('Kitchen')).toBeTruthy()
    expect(screen.getByText(/sous-chef/)).toBeTruthy()
    expect(screen.getByText('Bakery')).toBeTruthy()
    // A withdrawn preset is kept, not deleted — somebody's conversations are in there.
    expect(screen.getByText(/Frozen so it still runs: baker, recipe/)).toBeTruthy()
  })

  it('says nothing when the update touched no live agent', async () => {
    // A dialog that is usually empty is one people learn to dismiss unread —
    // including the time it was not empty.
    const store = await mount({ ...report, personas_fell_back: [], orphaned: [] })
    await store.getState().apply(HIT as never)

    expect(store.getState().report).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on acknowledgement', async () => {
    const store = await mount(report)
    await store.getState().apply(HIT as never)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(store.getState().report).toBeNull()
  })
})
