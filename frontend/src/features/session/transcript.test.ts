import { describe, expect, it } from 'vitest'
import { emptyTranscript, fromMessages, phaseLabel, reduce, reduceAll } from './transcript'
import type { ChatEvent, ChatMessage } from '@/types'

const turn: ChatEvent[] = [
  { kind: 'turn_started', turn_index: 0, user_message: 'read the file' },
  { kind: 'llm_started' },
  { kind: 'llm_completed', messages: [], duration_ms: 900 },
  { kind: 'tool_started', tool_call_id: 'c1', name: 'read_file', args: { path: 'a.rs' } },
  {
    kind: 'tool_completed',
    tool_call_id: 'c1',
    name: 'read_file',
    duration_ms: 12,
    result: { role: 'tool_result', id: 'c1', name: 'read_file', result: 'fn main() {}' },
  },
  { kind: 'reply', content: 'It is a main function.' },
  { kind: 'done', status: 'completed' },
]

describe('transcript reducer', () => {
  it('folds a whole turn into user → tool → reply', () => {
    const s = reduceAll(emptyTranscript(), turn)
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'tool', 'reply'])
    expect(s.busy).toBe(false)
    expect(s.lastStatus).toBe('completed')
  })

  it('names the silent phases, so a long wait says what it is waiting on', () => {
    // The whole point: compaction is an extra LLM call and recall is an
    // embeddings call, both before the model is even reached. They used to be
    // indistinguishable from thinking hard about the answer.
    let s = reduce(emptyTranscript(), turn[0]!)
    expect(s.phase).toBeUndefined()

    s = reduce(s, { kind: 'phase', phase: 'compacting' })
    expect(phaseLabel(s.phase)).toBe('Compacting context')
    s = reduce(s, { kind: 'phase', phase: 'recalling' })
    expect(phaseLabel(s.phase)).toBe('Searching memory')

    // The model call names itself; the pod does not send a frame for it.
    s = reduce(s, { kind: 'llm_started' })
    expect(phaseLabel(s.phase)).toBe('Waiting for the model')

    // Anything that produces output ends the waiting.
    s = reduce(s, { kind: 'llm_completed', messages: [], duration_ms: 1 })
    expect(s.phase).toBeUndefined()
    expect(s.thinking).toBe(false)
  })

  it('renders a phase from a newer pod rather than dropping it', () => {
    // A pod is rolled independently of this app. Falling back to "Thinking" for
    // a phase we have not heard of would undo the fix on the newest pods first.
    expect(phaseLabel('indexing_files')).toBe('Indexing files')
    expect(phaseLabel(undefined)).toBe('Thinking')
  })

  it('remembers which diagnostics session a turn belongs to', () => {
    // The handle the debug view opens with; `null` from an older pod must not
    // read as "there is one".
    const withId = reduce(emptyTranscript(), {
      kind: 'turn_started',
      turn_index: 0,
      user_message: 'go',
      session_id: '2026-08-26T05-28-20',
    })
    expect(withId.sessionId).toBe('2026-08-26T05-28-20')
    expect(reduce(emptyTranscript(), turn[0]!).sessionId).toBeUndefined()
  })

  it('leaves a notice when a turn is stopped, so it looks stopped and not hung', () => {
    // Mid-trace silence reads as a bug. The pod writes the sentence because the
    // pod knows who stopped it — including when that was another device.
    const s = reduceAll(emptyTranscript(), [
      ...turn.slice(0, 5),
      { kind: 'done', status: 'interrupted', reason: 'Stopped by the user.' },
    ])
    expect(s.lastStatus).toBe('interrupted')
    expect(s.busy).toBe(false)
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', content: 'Stopped by the user.' })
  })

  it('still says a turn stopped when the pod gave no reason', () => {
    const s = reduceAll(emptyTranscript(), [turn[0]!, { kind: 'done', status: 'interrupted' }])
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', content: 'Stopped.' })
  })

  it('completes a tool card in place rather than adding a second one', () => {
    const s = reduceAll(emptyTranscript(), turn)
    const tools = s.items.filter((i) => i.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ status: 'done', durationMs: 12, result: 'fn main() {}' })
  })

  it('is busy for the length of the turn', () => {
    let s = reduce(emptyTranscript(), turn[0]!)
    expect(s.busy).toBe(true)
    s = reduceAll(s, turn.slice(1, -1))
    expect(s.busy).toBe(true)
    s = reduce(s, turn.at(-1)!)
    expect(s.busy).toBe(false)
  })

  it('does not render free-text llm_completed content as a reply', () => {
    // Tool-only mode: the assistant's message arrives as `reply`, and treating
    // llm_completed content as one would double every answer.
    const s = reduceAll(emptyTranscript(), [
      { kind: 'turn_started', turn_index: 0, user_message: 'hi' },
      {
        kind: 'llm_completed',
        messages: [{ role: 'assistant', content: 'internal chatter' }],
        duration_ms: 5,
      },
      { kind: 'reply', content: 'hello' },
      { kind: 'done', status: 'completed' },
    ])
    const replies = s.items.filter((i) => i.kind === 'reply')
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ content: 'hello' })
  })

  it('shows a tool that completed before we attached', () => {
    // Joining a turn already in flight (fleet view opening a live session).
    const s = reduce(emptyTranscript(), {
      kind: 'tool_completed',
      tool_call_id: 'late',
      name: 'bash',
      duration_ms: 3,
      result: { role: 'tool_result', id: 'late', name: 'bash', result: 'ok' },
    })
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ kind: 'tool', status: 'done', name: 'bash' })
  })

  it('keeps the error frame and still ends on done', () => {
    const s = reduceAll(emptyTranscript(), [
      { kind: 'turn_started', turn_index: 0, user_message: 'go' },
      { kind: 'error', code: 'out_of_credits', message: 'no credits left', retryable: false },
      { kind: 'done', status: 'failed' },
    ])
    expect(s.items.at(-1)).toMatchObject({ kind: 'error', code: 'out_of_credits' })
    expect(s.busy).toBe(false)
    expect(s.lastStatus).toBe('failed')
  })

  it('ignores a frame kind it has never heard of', () => {
    // A pod rolled ahead of the desktop app must not break a live turn.
    const before = reduceAll(emptyTranscript(), turn.slice(0, 2))
    const after = reduce(before, { kind: 'llm_delta', text: 'x' } as unknown as ChatEvent)
    expect(after).toEqual(before)
  })
})

describe('fromMessages (a chat reopened after a restart)', () => {
  const stored: ChatMessage[] = [
    { role: 'user', content: 'read the file' },
    { role: 'assistant', content: 'internal chatter' },
    { role: 'tool_call', id: 'c1', call_id: 'c1', name: 'read_file', args: { path: 'a.rs' } },
    { role: 'tool_result', id: 'r1', call_id: 'c1', name: 'read_file', result: 'fn main() {}' },
    { role: 'tool_call', id: 'c2', call_id: 'c2', name: 'say_to_user', args: { message: 'It is a main function.' } },
    { role: 'tool_result', id: 'r2', call_id: 'c2', name: 'say_to_user', result: 'ok' },
  ]

  it('rebuilds the transcript the live reducer would have built', () => {
    // The whole point: leaving a chat and coming back must not change its shape.
    const seeded = fromMessages(stored)
    const live = reduceAll(emptyTranscript(), turn)
    expect(seeded.items.map((i) => i.kind)).toEqual(live.items.map((i) => i.kind))
  })

  it('renders a say_to_user call as the reply, not as a tool card', () => {
    // Left as a card it groups into the trace and the answer reads "Ran 1 tool".
    const s = fromMessages(stored)
    const replies = s.items.filter((i) => i.kind === 'reply')
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ content: 'It is a main function.' })
    expect(s.items.filter((i) => i.kind === 'tool')).toHaveLength(1)
  })

  it('drops free-text assistant content in tool-only mode', () => {
    const s = fromMessages(stored)
    expect(s.items.some((i) => i.kind === 'reply' && i.content === 'internal chatter')).toBe(false)
  })

  it('still treats assistant content as the reply when the chat has no say_to_user', () => {
    const s = fromMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'reply'])
    expect(s.items[1]).toMatchObject({ content: 'hello' })
  })

  it('folds tool_result into its call so a failed call still looks failed', () => {
    const s = fromMessages(stored)
    const tool = s.items.find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({ name: 'read_file', status: 'done', result: 'fn main() {}' })
  })

  it('pairs a result to its call by call_id, not by its own id', () => {
    const s = fromMessages([
      { role: 'tool_call', id: 'call-1', call_id: 'abc', name: 'bash', args: { command: 'ls' } },
      { role: 'tool_result', id: 'res-1', call_id: 'abc', name: 'bash', result: 'ok' },
    ])
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ kind: 'tool', result: 'ok' })
  })

  it('falls back to id when a pod omits call_id', () => {
    const s = fromMessages([
      { role: 'tool_call', id: 'c9', name: 'bash', args: { command: 'ls' } },
      { role: 'tool_result', id: 'c9', name: 'bash', result: 'ok' },
    ])
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ kind: 'tool', result: 'ok' })
  })

  it('reads the reply text from whichever key the pod used', () => {
    for (const args of [{ text: 'hi' }, { content: 'hi' }, { reply: 'hi' }, { body: 'hi' }]) {
      const s = fromMessages([{ role: 'tool_call', id: 'c', name: 'say_to_user', args }])
      expect(s.items[0]).toMatchObject({ kind: 'reply', content: 'hi' })
    }
  })

  it('keeps a say_to_user card when the text is nowhere it recognises', () => {
    // Better an odd card than a blank bubble where the answer should be.
    const s = fromMessages([{ role: 'tool_call', id: 'c', name: 'say_to_user', args: { wat: 1 } }])
    expect(s.items[0]).toMatchObject({ kind: 'tool', name: 'say_to_user' })
  })

  it('shows a result whose call was trimmed out of history', () => {
    const s = fromMessages([{ role: 'tool_result', id: 'orphan', name: 'bash', result: 'ok' }])
    expect(s.items[0]).toMatchObject({ kind: 'tool', name: 'bash', status: 'done', result: 'ok' })
  })

  it('opens a reopened chat idle, never mid-turn', () => {
    const s = fromMessages(stored)
    expect(s.busy).toBe(false)
    expect(s.thinking).toBe(false)
  })
})
