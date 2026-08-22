import { create } from 'zustand'
import { chats } from '@/rpc'
import { emptyTranscript, fromMessages, reduce, type TranscriptState } from '@/features/session/transcript'
import type { ChatEvent, ChatSummary } from '@/types'
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
  transcript: TranscriptState
  sending: boolean
  error: string | null
  /** Detach from the live stream; called when the session is closed. */
  unlisten?: () => void
}

interface SessionsState {
  byInstance: Record<string, Session>
  opening: Record<string, boolean>

  open: (instanceId: string) => Promise<void>
  send: (instanceId: string, message: string) => Promise<void>
  close: (instanceId: string) => void
  apply: (instanceId: string, ev: ChatEvent) => void
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
            transcript: fromMessages(detail.messages ?? []),
            sending: false,
            error: null,
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
            error: String(e),
          },
        },
      })
    } finally {
      const { [instanceId]: _, ...rest } = get().opening
      set({ opening: rest })
    }
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

  close: (instanceId) => {
    const session = get().byInstance[instanceId]
    session?.unlisten?.()
    const { [instanceId]: _, ...rest } = get().byInstance
    set({ byInstance: rest })
  },

  apply: (instanceId, ev) => {
    const session = get().byInstance[instanceId]
    if (!session) return
    const transcript = reduce(session.transcript, ev)
    set({
      byInstance: {
        ...get().byInstance,
        [instanceId]: { ...session, transcript, sending: transcript.busy },
      },
    })
    // The fleet card reads the same frames — one subscription drives both.
    useFleet
      .getState()
      .setStatus(
        instanceId,
        transcript.busy ? (transcript.thinking ? 'thinking' : 'running') : 'idle',
      )
  },
}))
