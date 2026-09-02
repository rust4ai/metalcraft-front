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
 * - A `done` that says `interrupted` leaves a notice in the transcript. A turn
 *   that stops has to look stopped, not abandoned.
 * - `phase` names the silent pre-model work (compaction, recall) so a long wait
 *   says what it is waiting on. Any frame that produces output clears it.
 * - `unknown` frames are ignored. A pod newer than this client must not break a
 *   live turn.
 */
import type { ChatEvent, ChatMessage, PlanStep } from '@/types'

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
  /** `awaitingReply` marks a question (`ask_user`) rather than an answer: the
   *  turn has ended but the conversation has not, and `options` are the answers
   *  the agent offered. The user may always type something else instead. */
  | { kind: 'reply'; id: string; content: string; awaitingReply?: boolean; options?: string[] }
  | { kind: 'error'; id: string; code: string; message: string; retryable: boolean }
  /** Local, never from the pod: the result of a slash command. Part of the
   *  transcript because that is where the user is looking, but it is this
   *  client talking, not the agent. */
  | { kind: 'notice'; id: string; content: string }
  /** Where the agent's context was reset: everything above stays readable, and
   *  the agent can no longer see any of it. Drawn rather than hidden because it
   *  is the answer to the only question the gap provokes — "it knew that a
   *  minute ago, why not now?" */
  | { kind: 'reset'; id: string; at: string; reason: string }
  /** A finished turn's receipt: what it cost, under the reply it belongs to.
   *
   *  Only ever produced by a *live* turn. A transcript restored from stored
   *  messages carries no timing — the pod does not keep one per message — so
   *  reloading drops these rather than inventing them. The pod's own recorded
   *  account of any run is the Runs mode, which has the breakdown this cannot. */
  | { kind: 'turnEnd'; id: string; tools: number; elapsedMs: number }
  | ToolCard

export interface TranscriptState {
  items: TranscriptItem[]
  /** True between `turn_started` and `done` — drives the composer lock and the
   *  fleet card's live status. */
  busy: boolean
  thinking: boolean
  /** What the turn is doing right now, when the pod has said. `undefined` is not
   *  "idle" — it is "no finer answer than busy", which is every pod older than
   *  the phase frames and every moment they do not cover. */
  phase?: TurnPhase
  /** The pod's diagnostics session for the turn in progress, from `turn_started`.
   *  The handle the debug view is opened with. */
  sessionId?: string
  lastStatus?: 'completed' | 'interrupted' | 'failed'
  /** Messages sent while a turn was running, in the order they were sent, still
   *  waiting to be taken up. Kept out of `items` because a queued message is not
   *  yet part of the conversation: it becomes a `user` item when the pod says it
   *  started (`injected`, or a `turn_started` carrying it). */
  queued: string[]
  /** The agent's plan for the current turn. Replaced wholesale on every `plan`
   *  frame, and empty between turns. */
  plan: PlanStep[]
  /** When the turn in flight began, by this client's clock. Wall time rather
   *  than the sum of the pod's reported durations, because those cover only
   *  what it traces — a turn that spent thirty seconds compacting would report
   *  twelve. This is what the person actually waited. */
  turnStartedAt?: number
  /** Tools completed in the turn in flight. */
  turnTools: number
}

/** The phases the pod names today, plus whatever a newer one names. */
export type TurnPhase = 'compacting' | 'recalling' | 'waiting' | (string & {})

/**
 * What to call a phase on screen.
 *
 * An unrecognised phase is humanised rather than dropped: a pod newer than this
 * client saying `indexing_files` should read as "Indexing files", not send the
 * view back to the undifferentiated "Thinking" this whole path exists to end.
 */
export function phaseLabel(phase: TurnPhase | undefined): string {
  switch (phase) {
    case undefined:
      return 'Thinking'
    case 'compacting':
      return 'Compacting context'
    case 'recalling':
      return 'Searching memory'
    case 'waiting':
      return 'Waiting for the model'
    default: {
      const words = phase.replace(/[_-]+/g, ' ').trim()
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Thinking'
    }
  }
}

export const emptyTranscript = (): TranscriptState => ({
  items: [],
  busy: false,
  thinking: false,
  queued: [],
  plan: [],
  turnTools: 0,
})

/** The list without its first occurrence of `value`, or unchanged if absent.
 *
 *  Removing *one* matters: sending the same text twice queues two entries, and
 *  the pod taking up the first must not clear both. */
function dropFirst(list: string[], value: string): string[] {
  const at = list.indexOf(value)
  return at === -1 ? list : [...list.slice(0, at), ...list.slice(at + 1)]
}

/** The tool whose call *is* the assistant's message; see the `reply` frame. */
const REPLY_TOOL = 'say_to_user'

/** Arg keys `say_to_user` might carry its text under, most likely first. */
const REPLY_KEYS = ['message', 'text', 'content', 'reply', 'body']

/** Pair a persisted `tool_result` back to its `tool_call`. Live frames key both
 *  halves on `tool_call_id`; persisted halves carry it as `call_id`, falling
 *  back to `id` for pods that only ever set that. */
const callKey = (m: { id: string; call_id?: string | null }): string => m.call_id ?? m.id

function replyText(args: unknown): string | undefined {
  if (typeof args === 'string') return args.trim() || undefined
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const key of REPLY_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

/**
 * Seed from a chat's persisted messages (a chat reopened after a restart).
 *
 * This has to land on the **same transcript** the live reducer built, or a chat
 * changes shape the moment you leave and come back. Two rules carry that, both
 * of them the stored mirror of a rule above:
 *
 * - A `say_to_user` call is the assistant's message, so it seeds a `reply`, not
 *   a tool card. Left as a card it collapses into the trace and a whole answer
 *   reads as "Ran 1 tool".
 * - In tool-only mode the free-text `assistant` content is internal chatter,
 *   exactly as in `llm_completed`, so it is dropped. A chat with no
 *   `say_to_user` call at all is a free-text chat, where that content *is* the
 *   reply — so the mode is decided per chat, by looking first.
 *
 * `tool_result` is folded into its call rather than ignored: without it a
 * reopened chat shows every failed call as a green tick.
 */
export function fromMessages(messages: ChatMessage[]): TranscriptState {
  const toolOnly = messages.some((m) => m.role === 'tool_call' && m.name === REPLY_TOOL)
  const items: TranscriptItem[] = []
  const cardsByCall = new Map<string, ToolCard>()
  /** Calls that became replies — their results are bookkeeping, not output. */
  const spoken = new Set<string>()

  for (const [i, m] of messages.entries()) {
    if (m.role === 'user') {
      items.push({ kind: 'user', id: `m${i}`, content: m.content })
    } else if (m.role === 'assistant') {
      if (!toolOnly && m.content.trim()) items.push({ kind: 'reply', id: `m${i}`, content: m.content })
    } else if (m.role === 'tool_call') {
      const text = m.name === REPLY_TOOL ? replyText(m.args) : undefined
      if (text !== undefined) {
        items.push({ kind: 'reply', id: `m${i}`, content: text })
        spoken.add(callKey(m))
        continue
      }
      // A `say_to_user` whose text we could not find still renders as a card:
      // an empty bubble would lose the turn entirely.
      const card: ToolCard = { kind: 'tool', id: m.id, name: m.name, args: m.args, status: 'done' }
      cardsByCall.set(callKey(m), card)
      items.push(card)
    } else if (m.role === 'reset') {
      items.push({ kind: 'reset', id: `m${i}`, at: m.at, reason: m.reason })
    } else if (m.role === 'tool_result') {
      if (spoken.has(callKey(m))) continue
      const card = cardsByCall.get(callKey(m))
      if (card) card.result = m.result
      // An orphan result means the call was trimmed from history; show the
      // finished card rather than dropping the tool call, as `reduce` does.
      else items.push({ kind: 'tool', id: m.id, name: m.name, args: null, status: 'done', result: m.result })
    }
  }
  return { ...emptyTranscript(), items }
}

export function reduce(
  state: TranscriptState,
  ev: ChatEvent,
  /** Injected so this stays a pure function of its inputs — the whole file is
   *  tested against fixed clocks, and a `Date.now()` in here would make the
   *  receipt untestable. */
  now: number = Date.now(),
): TranscriptState {
  switch (ev.kind) {
    case 'turn_started':
      return {
        ...state,
        busy: true,
        thinking: true,
        phase: undefined,
        turnStartedAt: now,
        turnTools: 0,
        // `?? undefined`: an older pod sends no session id, and `null` in the
        // field would read as "there is a session" to every `!= null` check.
        sessionId: ev.session_id ?? undefined,
        lastStatus: undefined,
        // A queued message that starts its own turn stops being queued. Matched
        // by text because that is all the frame carries; a duplicate message
        // sent twice loses one entry from the pending list, which is the right
        // trade against leaving a phantom there forever.
        queued: dropFirst(state.queued, ev.user_message),
        items: [
          ...state.items,
          { kind: 'user', id: `t${ev.turn_index}`, content: ev.user_message },
        ],
      }

    case 'phase':
      return { ...state, thinking: true, phase: ev.phase }

    // The model call is a phase too, and the one people wait on longest. Named
    // here rather than by the pod because `llm_started` already says it.
    case 'llm_started':
      return { ...state, thinking: true, phase: 'waiting' }

    case 'llm_completed':
      // Free-text content is deliberately not rendered: `reply` is the message.
      return { ...state, thinking: false, phase: undefined }

    case 'tool_started':
      return {
        ...state,
        thinking: false,
        phase: undefined,
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
      return { ...state, items, turnTools: state.turnTools + 1 }
    }

    case 'reply':
      return {
        ...state,
        thinking: false,
        phase: undefined,
        items: [
          ...state.items,
          {
            kind: 'reply',
            id: `r${state.items.length}`,
            content: ev.content,
            awaitingReply: ev.awaiting_reply,
            options: ev.options,
          },
        ],
      }

    case 'queued':
      // Taken, not started. The composer has already cleared, so this is the
      // only thing telling the person their message went anywhere.
      return { ...state, queued: [...state.queued, ev.message] }

    case 'injected':
      // It joined the turn already running: no longer pending, and now a real
      // part of the thread.
      return {
        ...state,
        queued: dropFirst(state.queued, ev.message),
        items: [...state.items, { kind: 'user', id: `q${state.items.length}`, content: ev.message }],
      }

    case 'plan':
      return { ...state, plan: ev.steps }

    case 'error':
      return {
        ...state,
        thinking: false,
        phase: undefined,
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

    case 'reset':
      // Arrives outside any turn — a flow resets before its 3am run — so it
      // touches neither `busy` nor `thinking`.
      return {
        ...state,
        items: [
          ...state.items,
          { kind: 'reset', id: `x${state.items.length}`, at: ev.at, reason: ev.reason },
        ],
      }

    case 'done': {
      // Only a turn that finished gets one, and only one this client saw start.
      //
      // Not on a failure: the error is the point there, and "0 tools · 3.2s"
      // under it is noise that also displaces the last thing in the transcript
      // — which is exactly what someone scrolling to the bottom is looking for.
      // Not on an interrupt either: the pod's own sentence about who stopped it
      // says the useful thing, and the time it ran before being stopped is not
      // a cost anyone is accounting for.
      const receipt: TranscriptItem[] =
        ev.status !== 'completed' || state.turnStartedAt === undefined
          ? []
          : [
              {
                kind: 'turnEnd',
                id: `e${state.items.length}`,
                tools: state.turnTools,
                elapsedMs: Math.max(0, now - state.turnStartedAt),
              },
            ]
      const next = {
        ...state,
        busy: false,
        thinking: false,
        phase: undefined,
        lastStatus: ev.status,
        turnStartedAt: undefined,
        turnTools: 0,
        items: [...state.items, ...receipt],
      }
      // A stopped turn has to say so where the user is looking. Without this the
      // agent simply goes quiet mid-trace, which reads as a bug rather than as
      // the thing that was just asked for. The pod writes the sentence (`reason`)
      // because the pod knows who stopped it — including when that was another
      // device watching the same chat.
      if (ev.status !== 'interrupted') return next
      return {
        ...next,
        items: [
          ...next.items,
          { kind: 'notice', id: `s${next.items.length}`, content: ev.reason ?? 'Stopped.' },
        ],
      }
    }

    default:
      return state
  }
}

export const reduceAll = (
  state: TranscriptState,
  events: ChatEvent[],
  now?: number,
): TranscriptState => events.reduce((s, ev) => reduce(s, ev, now), state)
