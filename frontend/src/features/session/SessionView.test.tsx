import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Transport } from '@/rpc/transport'
import type { ChatEvent } from '@/types'

afterEach(() => {
  cleanup()
  // The instance -> chat binding outlives a render; a test must not inherit the
  // conversation the previous one pinned.
  localStorage.clear()
})

/**
 * End-to-end through the renderer's half of the event bridge: a frame published
 * on `session://{chat_id}` has to reach the transcript and render. This is the
 * path that a blank-but-running window would silently break.
 */
async function mountSession(overrides: Record<string, unknown> = {}) {
  vi.resetModules()
  localStorage.clear()
  const listeners: Record<string, (p: unknown) => void> = {}
  const transport: Transport = {
    call: vi.fn(async (method: string) => {
      if (method in overrides) return overrides[method] as never
      switch (method) {
        case 'list_chats':
          return [{ id: 'c1', instance_id: 'i1', created_at: '2026-08-01T00:00:00Z' }] as never
        case 'get_chat':
          return { id: 'c1', instance_id: 'i1', messages: [{ role: 'user', content: 'earlier' }] } as never
        case 'watch_chat':
        case 'send_turn':
          return undefined as never
        case 'interrupt_turn':
          return true as never
        // Nothing armed for later. The strip is exercised in Followups.test.
        case 'scheduled_followups':
          return [] as never
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
  const { useSessions } = await import('@/stores/sessions')
  render(<SessionView instanceId="i1" />)
  const emit = (ev: ChatEvent) => listeners['session://c1']?.(ev)
  return { emit, transport, useSessions }
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

  it('offers the options of a question as chips, and sends the one clicked', async () => {
    // `ask_user` ends the turn waiting on the user. The options are a shortcut
    // for answering, so clicking one has to send exactly that text as the next
    // message — otherwise the chips are decoration.
    const { emit, transport } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())

    emit({
      kind: 'reply',
      content: 'Report the drift, or fix the page?',
      awaiting_reply: true,
      options: ['Just report it', 'Report and fix'],
    })
    emit({ kind: 'done', status: 'completed' })

    const chip = await waitFor(() => screen.getByText('Report and fix'))
    // The chips must not read as the whole answer space.
    expect(screen.getByText('Or answer in your own words below.')).toBeTruthy()

    fireEvent.click(chip)
    await waitFor(() =>
      expect(transport.call).toHaveBeenCalledWith(
        'send_turn',
        expect.objectContaining({ message: 'Report and fix' }),
      ),
    )
  })

  it('does not offer chips on a question the conversation has moved past', async () => {
    // Re-answering a settled question would send a message about work already
    // done, so the chips belong to the newest item only.
    const { emit } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())

    emit({
      kind: 'reply',
      content: 'Report the drift, or fix the page?',
      awaiting_reply: true,
      options: ['Just report it'],
    })
    emit({ kind: 'reply', content: 'Fixed 4 stale claims.' })
    emit({ kind: 'done', status: 'completed' })

    await waitFor(() => expect(screen.getByText('Fixed 4 stale claims.')).toBeTruthy())
    expect(screen.queryByText('Just report it')).toBeNull()
  })

  it('makes a bare URL in a reply a link, and opens it outside the app', async () => {
    // A preview URL is the whole point of the message it arrives in, and a link
    // nobody can click is a string to retype by hand.
    const { emit, transport } = await mountSession({ open_url: null })
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())

    emit({ kind: 'reply', content: 'Updated preview: https://2rycrfq356gm.livepreview.space/' })
    emit({ kind: 'done', status: 'completed' })

    const link = await waitFor(() => screen.getByText('https://2rycrfq356gm.livepreview.space/'))
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://2rycrfq356gm.livepreview.space/')

    // Through the core, not the webview: an in-window navigation would take the
    // app to the page with no way back.
    fireEvent.click(link)
    await waitFor(() =>
      expect(transport.call).toHaveBeenCalledWith('open_url', {
        url: 'https://2rycrfq356gm.livepreview.space/',
      }),
    )
  })

  it('says which silent phase it is in, not just that it is thinking', async () => {
    // The six-minute "Thinking": compaction and recall happen before the model
    // is reached and emit nothing else, so the wait used to have no explanation.
    const { emit } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())

    emit({ kind: 'turn_started', turn_index: 1, user_message: 'clone the repo' })
    await waitFor(() => expect(screen.getByText('Thinking')).toBeTruthy())

    emit({ kind: 'phase', phase: 'compacting' })
    await waitFor(() => expect(screen.getByText('Compacting context')).toBeTruthy())

    emit({ kind: 'llm_started' })
    await waitFor(() => expect(screen.getByText('Waiting for the model')).toBeTruthy())

    // Output ends the waiting indicator entirely.
    emit({ kind: 'reply', content: 'cloned' })
    emit({ kind: 'done', status: 'completed' })
    await waitFor(() => expect(screen.getByText('cloned')).toBeTruthy())
    expect(screen.queryByText('Waiting for the model')).toBeNull()
  })

  it('offers a stop while the agent works, and stops on the turn own word', async () => {
    const { emit, transport } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())
    // Nothing running: the only button is Send.
    expect(screen.queryByLabelText('Stop')).toBeNull()

    emit({ kind: 'turn_started', turn_index: 1, user_message: 'go' })
    const stop = await screen.findByLabelText('Stop')
    fireEvent.click(stop)

    await waitFor(() =>
      expect(transport.call).toHaveBeenCalledWith('interrupt_turn', { chatId: 'c1' }),
    )
    // Asked, not yet stopped — and the button says exactly that much.
    await waitFor(() => expect(screen.getByLabelText('Stopping')).toBeTruthy())

    // The pod's `done` is what ends the turn, on every device watching it.
    emit({ kind: 'done', status: 'interrupted', reason: 'Stopped by the user.' })
    await waitFor(() => expect(screen.getByText('Stopped by the user.')).toBeTruthy())
    expect(screen.queryByLabelText('Stopping')).toBeNull()
    expect(screen.getByLabelText('Send')).toBeTruthy()
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
  it('reopens a conversation whose session was dropped, rather than going blank', async () => {
    // The failure this exists for: the transcript lives in the store, so
    // anything that drops the entry used to leave a blank pane for ever — no
    // spinner, no error, no way back — while the agent went on running turns
    // that only the debug drawer could see.
    const { useSessions } = await mountSession()
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())

    useSessions.getState().close('i1')
    await waitFor(() => expect(screen.getByText('earlier')).toBeTruthy())
    expect(useSessions.getState().byInstance.i1?.chatId).toBe('c1')
  })

  it('says an empty conversation is empty', async () => {
    // An empty pane with no sentence in it is indistinguishable from a broken
    // one, which is exactly how this view failed.
    await mountSession({ get_chat: { id: 'c1', instance_id: 'i1', messages: [] } })
    await waitFor(() =>
      expect(screen.getByText(/Nothing in this conversation yet/)).toBeTruthy(),
    )
  })
})
