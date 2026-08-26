import { create } from 'zustand'
import { podLogs } from '@/rpc'
import { readTrace, type TurnTrace } from '@/features/session/turnTrace'
import type { PodSessionDetail } from '@/types'

/**
 * What the agent actually did, and how long each part of it took.
 *
 * Reads the pod's own record of a run: the OTLP trace for timings, the session
 * files for the payloads. Both are things the pod has always written and nothing
 * has ever shown — a turn that spent six minutes somewhere left a complete
 * account on disk, and the only way to see it was to have shell access to the
 * pod.
 *
 * Opened against a **run**, not a chat. A live turn names its own run in
 * `turn_started`; a chat opened later does not, so the store falls back to the
 * newest run this agent recorded — which is the one you come looking for after
 * something took too long.
 */
export interface TurnDebugState {
  open: boolean
  /** The run being shown, once one has been resolved. */
  sessionId: string | null
  loading: boolean
  /** `null` before a load, and whenever the pod could not be asked. */
  turns: TurnTrace[] | null
  detail: PodSessionDetail | null
  /** Set when there is nothing to show, and why — never rendered as an empty
   *  timeline, which reads as "the agent did nothing". */
  notice: string | null

  /** Open against a live run if there is one, else this agent's newest. */
  show: (instanceId: string, sessionId?: string) => Promise<void>
  hide: () => void
}

export const useTurnDebug = create<TurnDebugState>((set) => ({
  open: false,
  sessionId: null,
  loading: false,
  turns: null,
  detail: null,
  notice: null,

  show: async (instanceId, sessionId) => {
    set({ open: true, loading: true, notice: null, turns: null, detail: null, sessionId: sessionId ?? null })
    try {
      const id = sessionId ?? (await newestRun(instanceId))
      if (!id) {
        set({
          loading: false,
          notice:
            'This pod has no recorded runs for this agent — or it is too old to keep them. Send a message and the next turn will be recorded.',
        })
        return
      }
      // Both halves at once: the trace is what the drawer leads with, and the
      // session files are what someone scrolls to when the timeline raises a
      // question the durations cannot answer.
      const [trace, detail] = await Promise.all([podLogs.trace(id), podLogs.session(id)])
      // A run still in flight has a trace already — the pod writes it as it goes
      // — so this is worth showing even mid-turn.
      const turns = readTrace(trace)
      set({
        sessionId: id,
        loading: false,
        turns,
        detail: detail ?? null,
        notice:
          turns.length === 0
            ? 'That run has no trace. Runs recorded before this pod could trace them still have their messages below.'
            : null,
      })
    } catch (e) {
      set({ loading: false, notice: `Could not read the pod's record of this run: ${String(e)}` })
    }
  },

  hide: () => set({ open: false }),
}))

/**
 * The newest run this agent recorded.
 *
 * Filtered by instance rather than taking the newest run on the pod: a pod runs
 * every agent, its flows and its follow-ups, and opening a debug view onto
 * somebody else's run would be worse than opening onto nothing.
 */
async function newestRun(instanceId: string): Promise<string | undefined> {
  const sessions = await podLogs.sessions()
  // `null` is a pod too old to be asked, which the caller reports as having no
  // runs — there is nothing else it could show, and the sentence covers both.
  return sessions?.find((s) => s.instance_id === instanceId)?.id
}
