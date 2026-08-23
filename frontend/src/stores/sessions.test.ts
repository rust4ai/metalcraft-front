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

describe('submit', () => {
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
          error: null,
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

  it('unlocks the composer when a command fails', async () => {
    const { useSessions } = await mount({ compact_chat: new Error('chat is already mid-turn') })
    await useSessions.getState().submit('i1', '/compact')
    const s = useSessions.getState().byInstance.i1!
    expect(s.sending).toBe(false)
    expect(s.error).toContain('mid-turn')
  })
})
