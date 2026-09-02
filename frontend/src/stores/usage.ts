import { create } from 'zustand'
import { chats } from '@/rpc'
import type { ChatContext } from '@/types'

/**
 * What the open conversation currently costs (HARNESS_UI_PLAN §4, H5).
 *
 * One store, several readers at different sizes: a ring in the window bar, a
 * ring in the composer, a meter in the Inspector. They must not disagree, and
 * three components each asking the pod on their own mount is how they would.
 *
 * **This is an estimate and the UI has to say so.** `estimated_tokens` is the
 * pod's own ~4-chars-per-token approximation (`types.ts`), the same one its
 * automatic compaction decides on — which makes it the right number to show,
 * because it is the number that will actually trigger the compaction. It is not
 * a token count, and a readout that implies precision it does not have is the
 * kind of quiet lie §0 is about.
 *
 * A pod that cannot answer gets **no readout**, never a zero — the rule the
 * status bar's credits already follow. A zero here would read as "this
 * conversation is empty", which is a different and wrong claim.
 */
interface UsageState {
  byChat: Record<string, ChatContext>
  loading: Record<string, boolean>
  /** Chats the pod would not answer for. Kept so a failed read is not retried
   *  on every render, and so the reader can stay silent rather than guess. */
  failed: Record<string, true>

  load: (chatId: string) => Promise<void>
  /** Drop what is known about a chat — its next read starts clean. */
  forget: (chatId: string) => void
}

export const useUsage = create<UsageState>((set, get) => ({
  byChat: {},
  loading: {},
  failed: {},

  load: async (chatId) => {
    if (!chatId || get().loading[chatId]) return
    set((s) => ({ loading: { ...s.loading, [chatId]: true } }))
    try {
      const context = await chats.context(chatId)
      set((s) => ({
        byChat: { ...s.byChat, [chatId]: context },
        loading: { ...s.loading, [chatId]: false },
        failed: omit(s.failed, chatId),
      }))
    } catch {
      // A pod too old for the endpoint answers 404 and a broken one throws;
      // neither is worth an error on screen for a decorative readout, and both
      // mean the same thing here — there is no number to show.
      set((s) => ({
        loading: { ...s.loading, [chatId]: false },
        failed: { ...s.failed, [chatId]: true },
      }))
    }
  },

  forget: (chatId) =>
    set((s) => ({
      byChat: omit(s.byChat, chatId),
      loading: omit(s.loading, chatId),
      failed: omit(s.failed, chatId),
    })),
}))

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = map
  return rest
}

/** How full the context is, 0–1, or null when there is nothing trustworthy to
 *  say. Guards the divisor: a pod reporting a zero window would otherwise make
 *  this `Infinity` and paint a full ring on an empty conversation. */
export function fillOf(context: ChatContext | undefined): number | null {
  if (!context || !(context.context_window > 0)) return null
  return Math.min(context.estimated_tokens / context.context_window, 1)
}

/** Where the pod's automatic compaction fires, as the same 0–1 fraction — so the
 *  meter can mark it rather than leaving the number unexplained. */
export function thresholdOf(context: ChatContext | undefined): number | null {
  if (!context || !(context.context_window > 0) || !(context.compact_threshold_tokens > 0)) {
    return null
  }
  return Math.min(context.compact_threshold_tokens / context.context_window, 1)
}

/**
 * `<1%`, `42%`, `99%` — never `100%` short of actually full.
 *
 * Rounding 0.996 up to a flat `100%` on a conversation that still has room is
 * the readout saying the thing has stopped when it has not, so the top of the
 * range floors instead of rounding.
 */
export function percentLabel(fill: number): string {
  if (fill <= 0) return '0%'
  if (fill < 0.01) return '<1%'
  if (fill >= 1) return '100%'
  return `${Math.min(Math.floor(fill * 100), 99)}%`
}
