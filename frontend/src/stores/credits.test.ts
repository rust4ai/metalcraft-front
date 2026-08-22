import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '@/rpc/transport'

async function fresh(reply: unknown) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async () => reply as never),
    listen: vi.fn(async () => () => {}),
  } as Transport)
  return (await import('./credits')).useCredits
}

beforeEach(() => vi.resetModules())

describe('credits', () => {
  it('starts unknown rather than zero', async () => {
    const store = await fresh(null)
    expect(store.getState().supported).toBeNull()
    expect(store.getState().credits).toBeNull()
  })

  it('renders nothing when the deployment does not report credits', async () => {
    // `Ok(None)` from a 404. "0 credits" and "we don't know" look identical on a
    // readout and mean opposite things, so the bar must show neither.
    const store = await fresh(null)
    await store.getState().refresh()
    expect(store.getState().supported).toBe(false)
    expect(store.getState().credits).toBeNull()
  })

  it('takes the balance when the ledger answers', async () => {
    const store = await fresh({ credits: 1200, available: 1150, micro_credits: 1_200_000 })
    await store.getState().refresh()
    expect(store.getState().supported).toBe(true)
    // `available` is the spendable number: 50 are held by a turn in flight.
    expect(store.getState().credits?.available).toBe(1150)
  })

  it('survives a payload whose shape it did not expect', async () => {
    // The real bug this suite missed: the command briefly serialized
    // `available_credits`, and the bar read `available` and threw, which
    // unmounted the whole shell. The store must still take the reading; the
    // readout is what guards the render.
    const store = await fresh({ credits: 5 })
    await store.getState().refresh()
    expect(store.getState().supported).toBe(true)
    expect(store.getState().credits?.available).toBeUndefined()
  })

  it('keeps the last good balance when a poll fails', async () => {
    const store = await fresh({ credits: 1200, available: 1150, micro_credits: 1_200_000 })
    await store.getState().refresh()

    const t = await import('@/rpc/transport')
    t.setTransport({
      call: vi.fn(async () => {
        throw new Error('offline')
      }),
      listen: vi.fn(async () => () => {}),
    } as Transport)
    await store.getState().refresh()

    expect(store.getState().credits?.available).toBe(1150)
    expect(store.getState().supported).toBe(true)
  })
})
