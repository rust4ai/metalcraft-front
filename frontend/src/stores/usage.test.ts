import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '@/rpc/transport'

async function fresh(usage: unknown, { throws = false } = {}) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  const transport: Transport = {
    call: vi.fn(async () => {
      if (throws) throw new Error('offline')
      return usage as never
    }),
    listen: vi.fn(async () => () => {}),
  }
  t.setTransport(transport)
  return (await import('./usage')).useUsage
}

beforeEach(() => vi.resetModules())

describe('usage', () => {
  it('starts as unknown, not as zero', async () => {
    const store = await fresh(null)
    expect(store.getState().supported).toBeNull()
    expect(store.getState().usage).toBeNull()
  })

  it('marks the hub unsupported when it reports no usage', async () => {
    // PLAN §12.6 is unbuilt, so this is every hub today. The bar must render no
    // meter at all — an empty meter would claim nothing has been spent.
    const store = await fresh(null)
    await store.getState().refresh()
    expect(store.getState().supported).toBe(false)
    expect(store.getState().usage).toBeNull()
  })

  it('takes the reading when the hub does report one', async () => {
    const store = await fresh({ used: 0.42, window: 'month' })
    await store.getState().refresh()
    expect(store.getState().supported).toBe(true)
    expect(store.getState().usage?.used).toBe(0.42)
  })

  it('keeps the last good reading when a poll fails', async () => {
    const store = await fresh({ used: 0.42 })
    await store.getState().refresh()

    const t = await import('@/rpc/transport')
    t.setTransport({
      call: vi.fn(async () => {
        throw new Error('offline')
      }),
      listen: vi.fn(async () => () => {}),
    })
    await store.getState().refresh()

    // A blink of network trouble is not news, and a stale balance beats none.
    expect(store.getState().usage?.used).toBe(0.42)
    expect(store.getState().supported).toBe(true)
  })
})
