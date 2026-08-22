/**
 * The transcript reducer — the heart of the session view.
 *
 * Orca has to decode a PTY byte stream and guess where a tool call began; we get
 * typed frames, so this is a fold rather than a parser. Rules that matter:
 *
 * - A `reply` is the assistant's message. In tool-only mode the free-text in
 *   `llm_completed` is *not* the reply, so it is not rendered as one.
 * - Tool cards are keyed by `tool_call_id` and completed in place, so a card
 *   never duplicates when a pod re-broadcasts a frame (two subscribers, one
 *   turn: the fleet view and the open session both see it).
 * - An `error` renders as itself and `done` still arrives after it; the turn ends
 *   on `done` only.
 * - `unknown` frames are ignored. A pod newer than this client must not break a
 *   live turn.
 */
import type { ChatEvent, ChatMessage } from '@/types'

export interface ToolCard {
  kind: 'tool'
  id: string
  name: string
  args: unknown
  status: 'running' | 'done'
  durationMs?: number
  result?: string
}

export type TranscriptItem =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'reply'; id: string; content: string }
  | { kind: 'error'; id: string; code: string; message: string; retryable: boolean }
  | ToolCard

export interface TranscriptState {
  items: TranscriptItem[]
  /** True between `turn_started` and `done` — drives the composer lock and the
   *  fleet card's live status. */
  busy: boolean
  thinking: boolean
  lastStatus?: 'completed' | 'interrupted' | 'failed'
}

export const emptyTranscript = (): TranscriptState => ({ items: [], busy: false, thinking: false })

/** Seed from a chat's persisted messages (a chat reopened after a restart). */
export function fromMessages(messages: ChatMessage[]): TranscriptState {
  const items: TranscriptItem[] = []
  for (const [i, m] of messages.entries()) {
    if (m.role === 'user') items.push({ kind: 'user', id: `m${i}`, content: m.content })
    else if (m.role === 'assistant' && m.content.trim())
      items.push({ kind: 'reply', id: `m${i}`, content: m.content })
    else if (m.role === 'tool_call')
      items.push({ kind: 'tool', id: m.id, name: m.name, args: m.args, status: 'done' })
  }
  return { ...emptyTranscript(), items }
}

export function reduce(state: TranscriptState, ev: ChatEvent): TranscriptState {
  switch (ev.kind) {
    case 'turn_started':
      return {
        ...state,
        busy: true,
        thinking: true,
        lastStatus: undefined,
        items: [
          ...state.items,
          { kind: 'user', id: `t${ev.turn_index}`, content: ev.user_message },
        ],
      }

    case 'llm_started':
      return { ...state, thinking: true }

    case 'llm_completed':
      // Free-text content is deliberately not rendered: `reply` is the message.
      return { ...state, thinking: false }

    case 'tool_started':
      return {
        ...state,
        thinking: false,
        items: [
          ...state.items,
          { kind: 'tool', id: ev.tool_call_id, name: ev.name, args: ev.args, status: 'running' },
        ],
      }

    case 'tool_completed': {
      const result = ev.result.role === 'tool_result' ? ev.result.result : undefined
      let matched = false
      const items = state.items.map((it) => {
        if (it.kind === 'tool' && it.id === ev.tool_call_id && it.status === 'running') {
          matched = true
          return { ...it, status: 'done' as const, durationMs: ev.duration_ms, result }
        }
        return it
      })
      // A completion with no matching card means we attached mid-turn and missed
      // the start. Show the finished card rather than dropping the tool call.
      if (!matched) {
        items.push({
          kind: 'tool',
          id: ev.tool_call_id,
          name: ev.name,
          args: null,
          status: 'done',
          durationMs: ev.duration_ms,
          result,
        })
      }
      return { ...state, items }
    }

    case 'reply':
      return {
        ...state,
        thinking: false,
        items: [...state.items, { kind: 'reply', id: `r${state.items.length}`, content: ev.content }],
      }

    case 'error':
      return {
        ...state,
        thinking: false,
        items: [
          ...state.items,
          {
            kind: 'error',
            id: `e${state.items.length}`,
            code: ev.code,
            message: ev.message,
            retryable: ev.retryable,
          },
        ],
      }

    case 'done':
      return { ...state, busy: false, thinking: false, lastStatus: ev.status }

    default:
      return state
  }
}

export const reduceAll = (state: TranscriptState, events: ChatEvent[]): TranscriptState =>
  events.reduce(reduce, state)
