import { create } from 'zustand'
import { chats, fleet } from '@/rpc'
import { emptyTranscript, fromMessages, reduce, type TranscriptState } from '@/features/session/transcript'
import { describeCommandError, helpText, parse } from '@/features/session/commands'
import type { ChatDetail, ChatEvent, ChatSummary, ScheduledTask } from '@/types'
import { useFleet } from './fleet'

/**
 * Open conversations, one per agent instance.
 *
 * Opening an instance **reuses the chat it was last on**, by id, and falls back
 * to its most recent one only when there is no remembered id to honour. An
 * instance is long-lived and its conversation is the thing you come back to;
 * spawning a fresh chat on every click would scatter one relationship across a
 * dozen transcripts and lose the context the agent was relying on.
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
  /** Every conversation each agent has had, newest activity first. Loaded when
   *  the list is asked for rather than on every open — most sessions never ask. */
  conversations: Record<string, ChatSummary[]>
  loadingConversations: Record<string, boolean>

  open: (instanceId: string) => Promise<void>
  /** List this agent's conversations. */
  loadConversations: (instanceId: string) => Promise<void>
  /** Open one of this agent's other conversations, in place. */
  resume: (instanceId: string, chatId: string) => Promise<void>
  /** Open this agent **on this conversation**, whether or not a session for it
   *  is already open. What a flow run's "read what it said" link needs. */
  openAt: (instanceId: string, chatId: string) => Promise<void>
  /** Start another conversation with this agent, keeping its memory. */
  startConversation: (instanceId: string) => Promise<void>
  /** Delete one of this agent's other conversations. Refuses the open one. */
  deleteConversation: (instanceId: string, chatId: string) => Promise<void>
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

/**
 * Which chat each instance was last opened on, by id, across restarts.
 *
 * The heuristic below cannot carry this on its own. `newestChat` ranks by
 * `updated_at ?? created_at` — the pod sends `updated_at` now, so "most recent"
 * finally means most recently *spoken in* rather than most recently created, but
 * that still answers the wrong question when someone deliberately went back to an
 * older conversation. Pinning the id is what makes reopening one an identity
 * question instead of a ranking question.
 */
const CHATS_KEY = 'mc.chats'

function rememberedChats(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(CHATS_KEY) ?? 'null') as unknown
    return saved && typeof saved === 'object' ? (saved as Record<string, string>) : {}
  } catch {
    // A binding we cannot read is one we re-derive; never a reason to fail to
    // open a conversation.
    return {}
  }
}

function rememberChat(instanceId: string, chatId: string) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify({ ...rememberedChats(), [instanceId]: chatId }))
  } catch {
    // Private mode, quota, a wiped profile: the session still opens, it just
    // falls back to the newest chat next time.
  }
}

/**
 * The chat to open this instance on.
 *
 * Ordered by how much it knows: the id this instance was last on, then the
 * newest chat the pod lists for it, and only then a new one. Creating is the
 * last resort on purpose — a stray `create` mints a second conversation that
 * then *outranks* the real one by creation time, so the transcript with all the
 * history stops being reachable at all. That is only ever done when the pod has
 * answered and genuinely has no chat for this agent.
 */
async function resolveChat(instanceId: string): Promise<ChatDetail> {
  const remembered = rememberedChats()[instanceId]
  if (remembered) {
    try {
      const detail = await chats.get(remembered)
      // A chat that has moved to another agent is not this agent's conversation,
      // whatever we wrote down. Pods older than `instance_id` on chat detail send
      // nothing here, and silence is not a mismatch.
      if (!detail.instance_id || detail.instance_id === instanceId) return detail
    } catch {
      // Deleted, or on a pod that has never heard of it — re-derive below rather
      // than strand the agent on an id that no longer resolves.
    }
  }
  const existing = newestChat(await chats.list(), instanceId)
  return existing ? await chats.get(existing.id) : await chats.create({ instanceId })
}

/**
 * The instance's conversation, or undefined if it has none yet.
 *
 * Newest first, but **a conversation that has been spoken in outranks one that
 * has not**, however recently the empty one was made. That second rule is the
 * whole reason this is not a one-line sort: an empty chat is newer than the
 * transcript it was accidentally created beside, so ranking on time alone hands
 * the agent a blank pane and buries everything it had said. A pod too old to
 * report `turn_count` says nothing rather than zero, and nothing is not empty.
 */
const spokenIn = (c: ChatSummary) => (c.turn_count == null || c.turn_count > 0 ? 1 : 0)

/**
 * When a conversation was last touched.
 *
 * Last activity, not creation: a conversation someone has been in all day
 * belongs above one they opened this morning and abandoned. `updated_at` is
 * absent on pods older than the session list, where creation is the best
 * available answer.
 */
export const recency = (c: ChatSummary) => c.updated_at ?? c.created_at

export function newestChat(all: ChatSummary[], instanceId: string): ChatSummary | undefined {
  const mine = all.filter((c) => c.instance_id === instanceId)
  // `sort` rather than `toSorted`: the build targets safari15 for older macOS
  // webviews, and `mine` is already a fresh array from `filter`.
  // oxlint-disable-next-line unicorn/no-array-sort
  return mine.sort(
    (a, b) =>
      spokenIn(b) - spokenIn(a) ||
      Date.parse(recency(b)) - Date.parse(recency(a)),
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

/**
 * Live subscriptions, by instance — held outside the store on purpose.
 *
 * A session entry can go away (a close, a reset) while the transport
 * subscription it opened is still delivering; the handle has to outlive the
 * entry or the next open silently stacks a second listener on the same chat.
 */
const listeners: Record<string, () => void> = {}

function detach(instanceId: string) {
  listeners[instanceId]?.()
  delete listeners[instanceId]
}

export const useSessions = create<SessionsState>((set, get) => ({
  byInstance: {},
  opening: {},
  conversations: {},
  loadingConversations: {},

  open: async (instanceId) => {
    if (get().byInstance[instanceId] || get().opening[instanceId]) return
    set({ opening: { ...get().opening, [instanceId]: true } })
    try {
      const detail = await resolveChat(instanceId)
      // Pinned only once there is something in it. A chat with no messages is
      // not yet this agent's conversation — pinning one on sight is how a stray
      // empty chat used to become permanent, which is the failure the ranking in
      // `newestChat` exists to undo. `turn_started` pins it the moment it is
      // spoken in.
      if ((detail.messages ?? []).length > 0) rememberChat(instanceId, detail.id)
      // A previous listener for this instance outlives its session entry — the
      // transport's subscription is not the store's to lose. Attaching a second
      // one would double every reply in the transcript, so the old one goes
      // first, whatever became of the session it was opened for.
      detach(instanceId)
      // The entry lands *before* the subscription: `apply` drops frames for an
      // instance it has no session for, and a turn already running elsewhere
      // starts sending the moment the channel is attached.
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
          },
        },
      })
      const unlisten = await chats.onEvent(detail.id, (ev) => get().apply(instanceId, ev))
      listeners[instanceId] = unlisten
      // Attach to the broadcast channel so a turn already running elsewhere shows
      // up here too.
      await chats.watch(detail.id)
      const opened = get().byInstance[instanceId]
      // Only if this is still the session that was opened: a close, or a reopen
      // onto another chat, must not have a stale detach handle written into it.
      if (opened?.chatId === detail.id) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...opened, unlisten } } })
      }
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

  loadConversations: async (instanceId) => {
    set({ loadingConversations: { ...get().loadingConversations, [instanceId]: true } })
    try {
      // Asked of the agent. This used to filter the whole pod's chat list on
      // `instance_id`, which read every conversation on the pod to answer a
      // question about one agent — and silently dropped any chat written by a
      // pod too old to stamp an instance onto it.
      const mine = await fleet.conversations(instanceId)
      // oxlint-disable-next-line unicorn/no-array-sort
      mine.sort((a, b) => Date.parse(recency(b)) - Date.parse(recency(a)))
      set({ conversations: { ...get().conversations, [instanceId]: mine } })
    } catch (e) {
      // A list that will not load is not a conversation that will not load — the
      // one on screen is still live, so this reports on the session and stops.
      const session = get().byInstance[instanceId]
      if (session) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, error: String(e) } } })
      }
    } finally {
      const { [instanceId]: _, ...rest } = get().loadingConversations
      set({ loadingConversations: rest })
    }
  },

  openAt: async (instanceId, chatId) => {
    // Two states, one intent. `open` refuses to touch a session that already
    // exists and `resume` refuses to create one, so neither alone can honour
    // "open this agent on this chat" from a standing start.
    //
    // Pinning first is what makes the cold path land: `resolveChat` prefers the
    // remembered id over its ranking heuristic, and verifies the chat really
    // belongs to this agent before using it — so this reuses that check rather
    // than opening a chat id nobody vouched for.
    if (get().byInstance[instanceId]) return await get().resume(instanceId, chatId)
    rememberChat(instanceId, chatId)
    await get().open(instanceId)
  },

  resume: async (instanceId, chatId) => {
    const current = get().byInstance[instanceId]
    if (!current || current.chatId === chatId) return
    set({ opening: { ...get().opening, [instanceId]: true } })
    try {
      const detail = await chats.get(chatId)
      // Deliberate, unlike the guarded pin in `open`: going back to a
      // conversation on purpose is exactly the signal the ranking heuristic
      // cannot see, so it is remembered even when the transcript is empty.
      rememberChat(instanceId, detail.id)
      // The stream is per-conversation. Leaving the old one attached would
      // splice another conversation's frames into this transcript.
      detach(instanceId)
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
          },
        },
      })
      const unlisten = await chats.onEvent(detail.id, (ev) => get().apply(instanceId, ev))
      listeners[instanceId] = unlisten
      await chats.watch(detail.id)
      const opened = get().byInstance[instanceId]
      if (opened?.chatId === detail.id) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...opened, unlisten } } })
      }
    } catch (e) {
      const session = get().byInstance[instanceId]
      if (session) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, error: String(e) } } })
      }
    } finally {
      const { [instanceId]: _, ...rest } = get().opening
      set({ opening: rest })
    }
    await get().refreshFollowups(instanceId)
  },

  startConversation: async (instanceId) => {
    try {
      const created = await chats.create({ instanceId })
      await get().resume(instanceId, created.id)
      await get().loadConversations(instanceId)
    } catch (e) {
      const session = get().byInstance[instanceId]
      if (session) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, error: String(e) } } })
      }
    }
  },

  deleteConversation: async (instanceId, chatId) => {
    // Refuses the open one: deleting what you are reading would leave the pane
    // pointing at nothing, and "close it first" is a rule nobody can discover
    // from an empty screen.
    if (get().byInstance[instanceId]?.chatId === chatId) return
    try {
      await chats.remove(chatId)
      const rest = (get().conversations[instanceId] ?? []).filter((c) => c.id !== chatId)
      set({ conversations: { ...get().conversations, [instanceId]: rest } })
    } catch (e) {
      const session = get().byInstance[instanceId]
      if (session) {
        set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, error: String(e) } } })
      }
    }
  },

  send: async (instanceId, message) => {
    const session = get().byInstance[instanceId]
    if (!session || !session.chatId) return
    set({ byInstance: { ...get().byInstance, [instanceId]: { ...session, sending: true, error: null } } })
    try {
      await chats.send(session.chatId, message)
    } catch (e) {
      // A send can still fail — no such chat, pod unreachable — and surfacing it
      // beats leaving the composer locked on a turn that never started. What no
      // longer lands here is the concurrent-turn case: the pod queues a message
      // sent mid-turn and answers 202, so it arrives as a `queued` frame rather
      // than as an error.
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
      const result = await parsed.command.run({ chatId: session.chatId, instanceId })
      const current = get().byInstance[instanceId]
      if (!current) return
      set({
        byInstance: {
          ...get().byInstance,
          [instanceId]: {
            ...current,
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
    detach(instanceId)
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
    // The first word makes it the agent's conversation: from here on this is the
    // chat to come back to, whatever else gets created alongside it.
    if (ev.kind === 'turn_started' && session.chatId) rememberChat(instanceId, session.chatId)
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
