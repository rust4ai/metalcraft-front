import { describe, expect, it, vi } from 'vitest'
import { newestChat } from './sessions'
import type { ChatSummary } from '@/types'

const chat = (id: string, instance: string, updated: string): ChatSummary => ({
  id,
  instance_id: instance,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: updated,
})

describe('newestChat', () => {
  it('reuses the instance most recent conversation', () => {
    // An instance is long-lived and its conversation is what you come back to;
    // opening it must not scatter one relationship across new transcripts.
    const all = [
      chat('old', 'i1', '2026-08-01T00:00:00Z'),
      chat('new', 'i1', '2026-08-20T00:00:00Z'),
      chat('other', 'i2', '2026-08-22T00:00:00Z'),
    ]
    expect(newestChat(all, 'i1')?.id).toBe('new')
  })

  it('returns nothing for an instance with no chats, so the caller creates one', () => {
    expect(newestChat([chat('a', 'i1', '2026-08-01T00:00:00Z')], 'fresh')).toBeUndefined()
  })

  it('falls back to created_at when a chat has never been updated', () => {
    const all: ChatSummary[] = [
      { id: 'a', instance_id: 'i1', created_at: '2026-08-01T00:00:00Z' },
      { id: 'b', instance_id: 'i1', created_at: '2026-08-21T00:00:00Z' },
    ]
    expect(newestChat(all, 'i1')?.id).toBe('b')
  })
})

/**
 * Drives the real rpc layer over a stubbed transport, the same seam App.test
 * uses. Mocking `@/rpc` as a module instead would replace `auth`/`pods` with
 * undefined for anything that loaded it afterwards — which is exactly what it
 * did, hanging App's boot two files later.
 */
async function mount(overrides: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: Array<{ method: string; args?: Record<string, unknown> }> = []
  const responses: Record<string, unknown> = {
    send_turn: undefined,
    compact_chat: {
      compacted: true,
      tokens_before: 24_100,
      tokens_after: 6_800,
      messages_before: 38,
      messages_after: 12,
    },
    clear_chat: {},
    chat_context: {
      estimated_tokens: 12_400,
      message_count: 38,
      context_window: 128_000,
      compact_threshold_tokens: 76_800,
      would_compact: false,
    },
    ...overrides,
  }
  const transport = await import('@/rpc/transport')
  transport.setTransport({
    call: async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args })
      const r = responses[method]
      if (r instanceof Error) throw r
      return r as never
    },
    listen: async () => () => {},
  })
  const { useSessions } = await import('./sessions')
  const { emptyTranscript } = await import('@/features/session/transcript')
  useSessions.setState({
    byInstance: {
      i1: {
        instanceId: 'i1',
        chatId: 'c1',
        transcript: { ...emptyTranscript(), items: [{ kind: 'user', id: 'u0', content: 'hi' }] },
        sending: false,
        stopping: false,
        error: null,
        followups: null,
      },
    },
  })
  return {
    useSessions,
    sent: () => calls.filter((c) => c.method === 'send_turn').map((c) => c.args?.message),
    calls,
    items: () => useSessions.getState().byInstance.i1!.transcript.items,
    lastNotice: () => (useSessions.getState().byInstance.i1!.transcript.items.at(-1) as { content: string }).content,
  }
}

describe('submit', () => {
  it('sends ordinary text to the agent', async () => {
    const { useSessions, sent } = await mount()
    await useSessions.getState().submit('i1', 'what changed?')
    expect(sent()).toEqual(['what changed?'])
  })

  it('runs a command instead of spending a turn on it', async () => {
    const { useSessions, sent, items, lastNotice } = await mount()
    await useSessions.getState().submit('i1', '/compact')
    // The whole point: this never reaches the model.
    expect(sent()).toEqual([])
    expect(items().at(-1)).toMatchObject({ kind: 'notice' })
    expect(lastNotice()).toContain('~24k → ~6.8k')
  })

  it('empties the transcript when the conversation is cleared, but says why', async () => {
    // An empty pane with no explanation reads as a bug.
    const { useSessions, items } = await mount()
    await useSessions.getState().submit('i1', '/clear')
    expect(items()).toHaveLength(1)
    expect(items()[0]).toMatchObject({ kind: 'notice' })
  })

  it('names a command-shaped miss without touching the pod', async () => {
    const { useSessions, calls, lastNotice } = await mount()
    await useSessions.getState().submit('i1', '/compct')
    expect(calls).toEqual([])
    expect(lastNotice()).toContain('Unknown command')
  })

  it('answers /help without touching the pod', async () => {
    const { useSessions, calls, lastNotice } = await mount()
    await useSessions.getState().submit('i1', '/help')
    expect(calls).toEqual([])
    expect(lastNotice()).toContain('/compact')
  })

  it('sends a pasted path as a message', async () => {
    const { useSessions, sent } = await mount()
    await useSessions.getState().submit('i1', '/Users/amy/notes.md')
    expect(sent()).toEqual(['/Users/amy/notes.md'])
  })

  it('reports a failed command in the transcript, not over it', async () => {
    // `session.error` replaces the whole conversation with a red panel. Losing
    // what you were reading because a command missed is the wrong trade.
    const { useSessions, lastNotice } = await mount({
      compact_chat: new Error('409 Conflict /chats/c1/compact: chat is already mid-turn'),
    })
    await useSessions.getState().submit('i1', '/compact')
    const s = useSessions.getState().byInstance.i1!
    expect(s.sending).toBe(false)
    expect(s.error).toBeNull()
    expect(lastNotice()).toContain('mid-turn')
  })

  it('says a pod is old rather than that the chat is broken', async () => {
    // The commonest miss: a pod that serves the chat fine and 404s the command,
    // because these endpoints are newer than the chat surface. Axum answers an
    // unmatched route with an empty body — that is what tells it apart from the
    // pod's own "no such chat".
    const { useSessions, lastNotice } = await mount({
      compact_chat: new Error('404 Not Found /chats/c1/compact: '),
    })
    await useSessions.getState().submit('i1', '/compact')
    expect(lastNotice()).toContain('too old for /compact')
  })

  it('passes the pod its own words when it means the 404', async () => {
    const { useSessions, lastNotice } = await mount({
      compact_chat: new Error("404 Not Found /chats/c1/compact: chat 'c1' not found"),
    })
    await useSessions.getState().submit('i1', '/compact')
    expect(lastNotice()).toContain('not found')
    expect(lastNotice()).not.toContain('too old')
  })
})


describe('stop', () => {
  /** A session with a turn in flight — the only state stop has anything to do in. */
  async function midTurn(overrides: Record<string, unknown> = {}) {
    const m = await mount({ interrupt_turn: true, ...overrides })
    const s = m.useSessions.getState().byInstance.i1!
    m.useSessions.setState({
      byInstance: { i1: { ...s, transcript: { ...s.transcript, busy: true, thinking: true } } },
    })
    return {
      ...m,
      session: () => m.useSessions.getState().byInstance.i1!,
      stops: () => m.calls.filter((c) => c.method === 'interrupt_turn'),
      /** The `done` the pod sends once the executor notices. */
      finish: () =>
        m.useSessions
          .getState()
          .apply('i1', { kind: 'done', status: 'interrupted', reason: 'Stopped by the user.' }),
    }
  }

  it('asks the pod, then waits for the turn to say it stopped', async () => {
    // The gap is the whole design: the pod stops at the executor's next step
    // boundary, so the button must stay in "stopping" rather than claim a stop
    // that has not happened.
    const { useSessions, session, stops, finish } = await midTurn()
    await useSessions.getState().stop('i1')
    expect(stops()).toEqual([{ method: 'interrupt_turn', args: { chatId: 'c1' } }])
    expect(session().stopping).toBe(true)
    expect(session().transcript.busy).toBe(true)

    finish()
    expect(session().stopping).toBe(false)
    expect(session().transcript.busy).toBe(false)
    // The pod's own sentence, where the user is looking.
    expect(session().transcript.items.at(-1)).toMatchObject({
      kind: 'notice',
      content: 'Stopped by the user.',
    })
  })

  it('asks once, however many times it is pressed', async () => {
    const { useSessions, stops } = await midTurn()
    await useSessions.getState().stop('i1')
    await useSessions.getState().stop('i1')
    expect(stops()).toHaveLength(1)
  })

  it('says a pod cannot stop a turn rather than pretending it did', async () => {
    // Every pod older than the interrupt endpoint. Reporting a stop that never
    // happened would leave the agent working — and spending — behind a button
    // that looked like it worked.
    const { useSessions, session, lastNotice } = await midTurn({ interrupt_turn: null })
    await useSessions.getState().stop('i1')
    expect(session().stopping).toBe(false)
    expect(lastNotice()).toContain('cannot stop a turn')
    // Still running, and still shown as running.
    expect(session().transcript.busy).toBe(true)
  })

  it('stays quiet when the turn ended between the press and the ask', async () => {
    // A race the user did not cause and does not need told about; the turn's own
    // `done` frame already says it finished.
    const { useSessions, session, items } = await midTurn({ interrupt_turn: false })
    const before = items().length
    await useSessions.getState().stop('i1')
    expect(session().stopping).toBe(false)
    expect(items()).toHaveLength(before)
  })

  it('keeps the conversation when the ask itself fails', async () => {
    // `session.error` replaces the pane with a red panel. Losing the transcript
    // mid-turn, because a stop failed to send, is the wrong trade.
    const { useSessions, session, lastNotice } = await midTurn({
      interrupt_turn: new Error('transport: connection refused'),
    })
    await useSessions.getState().stop('i1')
    expect(session().stopping).toBe(false)
    expect(session().error).toBeNull()
    expect(lastNotice()).toContain('Could not stop the turn')
  })

  it('does nothing at all when no turn is running', async () => {
    const { useSessions, calls } = await mount({ interrupt_turn: true })
    await useSessions.getState().stop('i1')
    expect(calls).toEqual([])
  })
})
