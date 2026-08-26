import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Transport } from '@/rpc/transport'
import type { ScheduledTask } from '@/types'

afterEach(cleanup)

/** 2026-08-25T12:00:00Z, so every `run_at` below is an exact offset from it. */
const NOW = Date.parse('2026-08-25T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'sch_1',
    chat_id: 'c1',
    run_at: new Date(NOW + 167_000).toISOString(), // 2:47
    task: 're-check the buildr.space workspace',
    status: 'pending',
    ...over,
  }
}

/**
 * Mounts the real session view against a stub pod so the strip is exercised the
 * way it ships: the store opens the chat, asks for follow-ups, and the component
 * reads what came back.
 */
async function mount(followups: ScheduledTask[] | null) {
  vi.resetModules()
  const cancelled: string[] = []
  const transport: Transport = {
    call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      switch (method) {
        case 'list_chats':
          return [{ id: 'c1', instance_id: 'i1', created_at: '2026-08-01T00:00:00Z' }] as never
        case 'get_chat':
          return { id: 'c1', instance_id: 'i1', messages: [] } as never
        case 'scheduled_followups':
          return followups as never
        case 'cancel_followup':
          cancelled.push(String(args?.id))
          followups = (followups ?? []).filter((t) => t.id !== args?.id)
          return undefined as never
        case 'watch_chat':
          return undefined as never
        default:
          throw new Error(`unstubbed: ${method}`)
      }
    }),
    listen: vi.fn(async () => () => {}),
  }
  const t = await import('@/rpc/transport')
  t.setTransport(transport)
  const { SessionView } = await import('../session/SessionView')
  render(<SessionView instanceId="i1" />)
  return { cancelled, transport }
}

describe('Followups', () => {
  it('counts down to an armed follow-up, naming the work', async () => {
    await mount([task()])
    await waitFor(() => expect(screen.getByText('Follows up in 2:47')).toBeTruthy())
    expect(screen.getByText('re-check the buildr.space workspace')).toBeTruthy()
  })

  it('ticks the countdown down as time passes', async () => {
    await mount([task()])
    await waitFor(() => expect(screen.getByText('Follows up in 2:47')).toBeTruthy())
    vi.setSystemTime(NOW + 60_000)
    await vi.advanceTimersByTimeAsync(1000)
    await waitFor(() => expect(screen.getByText('Follows up in 1:47')).toBeTruthy())
  })

  /** `run_at` is a floor — the daemon claims due jobs on its next poll tick, so
   *  a passed deadline must not read as a missed one. */
  it('stops at the deadline rather than counting negative', async () => {
    await mount([task({ run_at: new Date(NOW - 5_000).toISOString() })])
    await waitFor(() => expect(screen.getByText('Following up any moment')).toBeTruthy())
  })

  it('cancels a pending follow-up and drops the row', async () => {
    const { cancelled } = await mount([task()])
    await waitFor(() => expect(screen.getByText('Follows up in 2:47')).toBeTruthy())
    screen.getByLabelText('Cancel this follow-up').click()
    await waitFor(() => expect(cancelled).toEqual(['sch_1']))
    await waitFor(() => expect(screen.queryByText('Follows up in 2:47')).toBeNull())
  })

  /** A failed job is the only outcome that is otherwise completely silent. */
  it('reports a follow-up that died, without a cancel it cannot honour', async () => {
    await mount([task({ status: 'failed', run_at: new Date(NOW - 30_000).toISOString() })])
    await waitFor(() => expect(screen.getByText('Follow-up failed')).toBeTruthy())
    expect(screen.queryByLabelText('Cancel this follow-up')).toBeNull()
  })

  it('lets an old failure go rather than marking the chat forever', async () => {
    await mount([task({ status: 'failed', run_at: '2026-08-24T12:00:00Z' })])
    await waitFor(() => expect(screen.queryByText(/Follow-up failed/)).toBeNull())
  })

  /** A pod too old to be asked answers `null`. Rendering that as "nothing is
   *  scheduled" would be the same unbacked claim the strip exists to catch. */
  it('says nothing at all when the pod cannot be asked', async () => {
    await mount(null)
    await waitFor(() => expect(screen.getByPlaceholderText(/Ask this agent/)).toBeTruthy())
    expect(screen.queryByText(/Follows up/)).toBeNull()
  })

  it('shows nothing when the chat has nothing armed', async () => {
    await mount([])
    await waitFor(() => expect(screen.getByPlaceholderText(/Ask this agent/)).toBeTruthy())
    expect(screen.queryByText(/Follows up/)).toBeNull()
  })
})

describe('countdown', () => {
  it('reads as m:ss under an hour and Hh MMm above', async () => {
    const { countdown } = await import('./Followups')
    expect(countdown(167_000)).toBe('2:47')
    expect(countdown(9_000)).toBe('0:09')
    expect(countdown(3 * 3600_000 + 4 * 60_000)).toBe('3h 04m')
  })
})
