import { describe, expect, it } from 'vitest'
import { emptyTranscript, reduce, reduceAll } from './transcript'
import type { ChatEvent } from '@/types'

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
