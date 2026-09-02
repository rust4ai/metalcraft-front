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
 * Read against a **run**, not a chat. A live turn names its own run in
 * `turn_started`; a chat opened later does not, so the store falls back to the
 * newest run this agent recorded — which is the one you come looking for after
 * something took too long.
 *
 * It used to drive a drawer, and carried an `open` flag to do it. Since the Runs
 * *mode* (HARNESS_UI_PLAN H3) the panel's visibility is the session's mode and
 * nothing here — a store that also knew whether it was on screen would be a
 * second, disagreeing answer to a question the router already settles.
 */
export interface TurnDebugState {
  /** Whose runs these are. The panel checks it before rendering: this store
   *  holds one agent's runs at a time, and without a name on them a slow reply
   *  is indistinguishable from the right one. */
  instanceId: string | null
  /** The run being shown, once one has been resolved. */
  sessionId: string | null
  loading: boolean
  /** `null` before a load, and whenever the pod could not be asked. */
  turns: TurnTrace[] | null
  detail: PodSessionDetail | null
  /** Set when there is nothing to show, and why — never rendered as an empty
   *  timeline, which reads as "the agent did nothing". */
  notice: string | null

  /** Read a live run if there is one, else this agent's newest. */
  load: (instanceId: string, sessionId?: string) => Promise<void>
}

/**
 * Which read is the current one.
 *
 * This store holds a single run, and the Runs *mode* re-reads it on every
 * navigation between agents — where the drawer it replaced was opened once,
 * deliberately, and could not race itself. Two loads in flight means the slower
 * one lands last, so an agent you have already navigated away from can write its
 * trace into a panel showing somebody else's name. The token makes every reply
 * but the newest a no-op.
 */
let latest = 0

export const useTurnDebug = create<TurnDebugState>((set) => ({
  instanceId: null,
  sessionId: null,
  loading: false,
  turns: null,
  detail: null,
  notice: null,

  load: async (instanceId, sessionId) => {
    const mine = ++latest
    const stale = () => mine !== latest
    set({
      instanceId,
      loading: true,
      notice: null,
      turns: null,
      detail: null,
      sessionId: sessionId ?? null,
    })
    try {
      const id = sessionId ?? (await newestRun(instanceId))
      if (stale()) return
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
      if (stale()) return
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
      // A superseded read's failure is not this agent's failure, and reporting
      // it here would put the wrong agent's error under the right one's name.
      if (stale()) return
      set({ loading: false, notice: `Could not read the pod's record of this run: ${String(e)}` })
    }
  },
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
