import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Transport } from '@/rpc/transport'
import type { ChatEvent } from '@/types'

afterEach(cleanup)

/**
 * End-to-end through the renderer's half of the event bridge: a frame published
 * on `session://{chat_id}` has to reach the transcript and render. This is the
 * path that a blank-but-running window would silently break.
 */
async function mountSession() {
  vi.resetModules()
  const listeners: Record<string, (p: unknown) => void> = {}
  const transport: Transport = {
    call: vi.fn(async (method: string) => {
      switch (method) {
        case 'list_chats':
          return [{ id: 'c1', instance_id: 'i1', created_at: '2026-08-01T00:00:00Z' }] as never
        case 'get_chat':
          return { id: 'c1', instance_id: 'i1', messages: [{ role: 'user', content: 'earlier' }] } as never
        case 'watch_chat':
        case 'send_turn':
          return undefined as never
        default:
          throw new Error(`unstubbed: ${method}`)
      }
    }),
    listen: vi.fn(async (channel: string, cb: (p: never) => void) => {
      listeners[channel] = cb as (p: unknown) => void
      return () => delete listeners[channel]
    }),
  }
  const t = await import('@/rpc/transport')
  t.setTransport(transport)
  const { SessionView } = await import('./SessionView')
  render(<SessionView instanceId="i1" />)
  const emit = (ev: ChatEvent) => listeners['session://c1']?.(ev)
  return { emit, transport }
}

describe('SessionView', () => {
  it('restores the persisted transcript of the instance existing chat', async () => {
    await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())
  })

  it('renders live frames: tool trace then reply', async () => {
    const { emit } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())

    emit({ kind: 'turn_started', turn_index: 1, user_message: 'run it' })
    emit({ kind: 'tool_started', tool_call_id: 'c', name: 'bash', args: { cmd: 'ls' } })
    // Chips read as verb + target, not as a raw tool name.
    await waitFor(() => expect(screen.getByText('Run')).toBeTruthy())
    expect(screen.getByText('ls')).toBeTruthy()
    expect(screen.getByText('Running tools')).toBeTruthy()

    emit({
      kind: 'tool_completed',
      tool_call_id: 'c',
      name: 'bash',
      duration_ms: 4,
      result: { role: 'tool_result', id: 'c', name: 'bash', result: 'a.rs' },
    })
    emit({ kind: 'reply', content: 'all done' })
    emit({ kind: 'done', status: 'completed' })
    await waitFor(() => expect(screen.getByText('all done')).toBeTruthy())
    // Settled traces speak in the past tense — a finished trace still saying
    // "Running tools" is the classic way agent UI looks broken.
    expect(screen.getByText('Ran 1 tool')).toBeTruthy()
  })

  it('shows a classified failure in the user own words', async () => {
    const { emit } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())
    emit({ kind: 'turn_started', turn_index: 1, user_message: 'go' })
    emit({ kind: 'error', code: 'out_of_credits', message: 'You are out of credits.', retryable: false })
    emit({ kind: 'done', status: 'failed' })
    await waitFor(() => expect(screen.getByText('You are out of credits.')).toBeTruthy())
    expect(screen.getByText(/out_of_credits/)).toBeTruthy()
  })
})
