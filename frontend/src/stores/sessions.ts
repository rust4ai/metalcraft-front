import { create } from 'zustand'
import { chats } from '@/rpc'
import { emptyTranscript, fromMessages, reduce, type TranscriptState } from '@/features/session/transcript'
import { describeCommandError, helpText, parse } from '@/features/session/commands'
import type { ChatEvent, ChatSummary, ScheduledTask } from '@/types'
import { useFleet } from './fleet'

/**
 * Open conversations, one per agent instance.
 *
 * Opening an instance **reuses its most recent chat** rather than starting a new
 * one. An instance is long-lived and its conversation is the thing you come back
 * to; spawning a fresh chat on every click would scatter one relationship across
 * a dozen transcripts and lose the context the agent was relying on.
 *
 * Live frames arrive on `session://{chat_id}` whether this client drove the turn
 * or not, so a session opened while the agent is mid-turn (fired by a schedule, a
 * gateway message, another device) simply joins in progress.
 */
export interface Session {
  instanceId: string
  chatId: string
  /** Which model this conversation runs on. Chosen at creation and not
   *  changeable afterwards (the pod has no endpoint for it), so it is reported
   *  rather than offered as a control. */
  modelName?: string | null
  transcript: TranscriptState
  sending: boolean
  /** True from the moment stop is pressed until the turn's `done` frame lands.
   *  The pod stops at the executor's next step boundary, so there is a real gap
   *  between the press and the stop — the button has to show that rather than
   *  look ignored. */
  stopping: boolean
  error: string | null
  /** Follow-ups this chat will act on later, or `null` when the pod cannot be
   *  asked (too old to have the endpoint). The two are deliberately distinct:
   *  an empty list says "nothing is scheduled", and only a pod that answered
   *  has the standing to say that. */
  followups: ScheduledTask[] | null
  /** Detach from the live stream; called when the session is closed. */
  unlisten?: () => void
}

interface SessionsState {
  byInstance: Record<string, Session>
  opening: Record<string, boolean>

  open: (instanceId: string) => Promise<void>
  send: (instanceId: string, message: string) => Promise<void>
  /** Send, unless the text is a slash command — then act on the conversation
   *  instead of continuing it. The composer's only entry point. */
  submit: (instanceId: string, input: string) => Promise<void>
  /** Interrupt the running turn. Asks the pod and returns; the composer is
   *  unlocked by the `done` frame that follows, not by this. */
  stop: (instanceId: string) => Promise<void>
  close: (instanceId: string) => void
  apply: (instanceId: string, ev: ChatEvent) => void
  /** Re-read what the agent armed for later. Called when a session opens and
   *  again whenever a turn ends, because the end of a turn is exactly when a
   *  new follow-up would have been armed. */
  refreshFollowups: (instanceId: string) => Promise<void>
}

/** The instance's newest conversation, or undefined if it has none yet. */
export function newestChat(all: ChatSummary[], instanceId: string): ChatSummary | undefined {
  const mine = all.filter((c) => c.instance_id === instanceId)
  // `sort` rather than `toSorted`: the build targets safari15 for older macOS
  // webviews, and `mine` is already a fresh array from `filter`.
  // oxlint-disable-next-line unicorn/no-array-sort
  return mine.sort(
    (a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at),
  )[0]
}

/**
 * Put this client's own words in the transcript.
 *
 * Notices are how the app speaks in a conversation it does not own — a command's
 * result, a pod that cannot do what was asked. Written through the store's own
 * handle rather than a closure so every caller reads the *current* transcript:
 * the frame that lands while an await is in flight must not be overwritten.
 */
function notice(instanceId: string, content: string) {
  const { byInstance } = useSessions.getState()
  const current = byInstance[instanceId]
  if (!current) return
  useSessions.setState({
    byInstance: {
      ...byInstance,
      [instanceId]: {
        ...current,
        transcript: {
          ...current.transcript,
          items: [
            ...current.transcript.items,
            { kind: 'notice', id: `n${current.transcript.items.length}`, content },
          ],
        },
      },
    },
  })
}

export const useSessions = create<SessionsState>((set, get) => ({
  byInstance: {},
  opening: {},

  open: async (instanceId) => {
    if (get().byInstance[instanceId] || get().opening[instanceId]) return
    set({ opening: { ...get().opening, [instanceId]: true } })
    try {
      const existing = newestChat(await chats.list(), instanceId)
      const detail = existing ? await chats.get(existing.id) : await chats.create({ instanceId })
      const unlisten = await chats.onEvent(detail.id, (ev) => get().apply(instanceId, ev))
      // Attach to the broadcast channel so a turn already running elsewhere shows
      // up here too.
      await chats.watch(detail.id)
      set({
        byInstance: {
          ...get().byInstance,
          [instanceId]: {
            instanceId,
            chatId: detail.id,
            modelName: detail.model_name,
            transcript: fromMessages(detail.messages ?? []),
            sending: false,
            stopping: false,
            error: null,
            followups: null,
            unlisten,
          },
        },
      })
    } catch (e) {
      set({
        byInstance: {
          ...get().byInstance,
          [instanceId]: {
            instanceId,
            chatId: '',
            transcript: emptyTranscript(),
            sending: false,
            stopping: false,
            error: String(e),
            followups: null,
          },
        },
      })
    } finally {
      const { [instanceId]: _, ...rest } = get().opening
      set({ opening: rest })
    }
    // After the session is in the store, so the answer has somewhere to land.
    await get().refreshFollowups(instanceId)
  },

  send: async (instanceId, message) => {
    const session = get().byInstance[instanceId]
    if (!session || !session.chatId) return
    set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, sending: true, error: null } } })
    try {
      await chats.send(session.chatId, message)
    } catch (e) {
      // The pod refuses a concurrent turn per chat with a 409; surface that
      // rather than leaving the composer locked on a turn that never started.
      const current = get().byInstance[instanceId]
      if (current) {
        set({
          byInstance: { ...get().byInstance, [instanceId]: { ...current, sending: false, error: String(e) } },
        })
      }
    }
  },

  submit: async (instanceId, input) => {
    const session = get().byInstance[instanceId]
    if (!session || !session.chatId) return
    const parsed = parse(input)
    if (parsed.kind === 'message') return get().send(instanceId, input)

    if (parsed.kind === 'unknown') {
      return notice(instanceId, `Unknown command: ${parsed.name}. Try /help.`)
    }
    if (!parsed.command.run) return notice(instanceId, helpText())

    // Commands lock the composer the way a turn does: /compact pays for a
    // summarization call, and the pod refuses a turn while it runs anyway.
    set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, sending: true, error: null } } })
    try {
      const result = await parsed.command.run(session.chatId)
      const current = get().byInstance[instanceId]
      if (!current) return
      set({
        byInstance: {
          ...get().byInstance,
          [instanceId]: {
            ...current,
            // A cleared conversation keeps the notice that says so — an empty
            // pane with no explanation reads as a bug.
            transcript: result.cleared ? emptyTranscript() : current.transcript,
            sending: false,
          },
        },
      })
      if (result.notice) notice(instanceId, result.notice)
    } catch (e) {
      // A failed command reports itself in the transcript, never as the session
      // error — that one replaces the whole conversation with a red panel, and
      // losing what you were reading because a command missed is the wrong
      // trade. The commonest miss is an old pod, which is not broken at all.
      const current = get().byInstance[instanceId]
      if (current) {
        set({
          byInstance: { ...get().byInstance, [instanceId]: { ...current, sending: false } },
        })
      }
      notice(instanceId, describeCommandError(e, parsed.command.name))
    }
  },

  stop: async (instanceId) => {
    const session = get().byInstance[instanceId]
    // Nothing running, or a press already in flight. Asking twice cannot stop a
    // turn any harder and would only put a second notice on screen.
    if (!session?.chatId || !session.transcript.busy || session.stopping) return
    set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, stopping: true } } })

    const settle = () => {
      const current = get().byInstance[instanceId]
      if (current) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...current, stopping: false } } })
      }
    }

    try {
      const stopping = await chats.interrupt(session.chatId)
      // `true` is the only answer that leaves the button in its stopping state:
      // the pod took the request and the turn now ends on its own, which arrives
      // as the `done` frame `apply` is already waiting for.
      if (stopping) return
      settle()
      if (stopping === null) {
        notice(
          instanceId,
          'This pod cannot stop a turn — it is older than the interrupt endpoint. The turn will finish on its own.',
        )
      }
      // `false` says the turn ended between the press and the request. Its own
      // `done` frame is what says so on screen; a notice would only report the
      // race, which is not something the user did or needs to know.
    } catch (e) {
      settle()
      // Never the session error: that replaces the whole conversation with a red
      // panel, and a stop that failed to send must not cost you what you were
      // reading — least of all mid-turn, with the agent still working.
      notice(instanceId, `Could not stop the turn: ${String(e)}`)
    }
  },

  close: (instanceId) => {
    const session = get().byInstance[instanceId]
    session?.unlisten?.()
    const { [instanceId]: _, ...rest } = get().byInstance
    set({ byInstance: rest })
  },

  refreshFollowups: async (instanceId) => {
    const session = get().byInstance[instanceId]
    if (!session?.chatId) return
    try {
      const followups = await chats.followups(session.chatId)
      const current = get().byInstance[instanceId]
      // The session can close, or reopen onto another chat, while this is in
      // flight; landing an answer on the wrong chat would be worse than none.
      if (!current || current.chatId !== session.chatId) return
      set({ byInstance: { ...get().byInstance, [instanceId]: { ...current, followups } } })
    } catch {
      // A pod that refuses the question is one this client cannot claim anything
      // about, which is what `null` already says — and a failed poll must never
      // cost the user the conversation they are reading.
    }
  },

  apply: (instanceId, ev) => {
    const session = get().byInstance[instanceId]
    if (!session) return
    const transcript = reduce(session.transcript, ev)
    set({
      byInstance: {
        ...get().byInstance,
        // A turn that has ended is not stopping any more, whether it stopped
        // because of the button, finished on its own, or failed.
        [instanceId]: {
          ...session,
          transcript,
          sending: transcript.busy,
          stopping: session.stopping && transcript.busy,
        },
      },
    })
    // The fleet card reads the same frames — one subscription drives both.
    useFleet
      .getState()
      .setStatus(
        instanceId,
        transcript.busy ? (transcript.thinking ? 'thinking' : 'running') : 'idle',
      )
    // A turn ending is when a follow-up was armed (the agent schedules one and
    // then stops) and also when a fired one finished delivering. Both change
    // what is pending, so this is the one frame worth re-asking on.
    if (ev.kind === 'done') void get().refreshFollowups(instanceId)
  },
}))
