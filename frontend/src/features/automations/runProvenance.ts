import type { FlowRun } from '@/types'

/**
 * Who a flow run ran as, and where to read what it said.
 *
 * A run is not a log the pod keeps off to one side. Every flow that has ever run
 * has an agent — its own, minted by the first run or by arming, whichever came
 * first — and every run is one conversation inside it. Each prompt and branch
 * turn recalls from and writes to that agent's memory, and the run signs off
 * with how it ended even when it never spoke. So "what did my 3am automation
 * do" has a better answer than a node trace: the transcript.
 *
 * Two kinds of run still cannot give that answer, which is why this is a union
 * rather than an id: a pod with nothing spawnable to run as (no presets
 * installed) leaves the run anonymous, and an agent can since have been deleted.
 */
export type RunProvenance =
  /** Ran as an agent and wrote a conversation there. Both ids are the way in. */
  | { kind: 'conversation'; instanceId: string; chatId: string; agentName?: string }
  /** Ran as an agent, but the pod recorded no conversation for it — an older pod,
   *  which opened one only for runs that spoke. Still worth naming and opening:
   *  this run touched that agent's memory. */
  | { kind: 'silent'; instanceId: string; agentName?: string }
  /** Ran as an agent this pod no longer has. Its conversations went with it. */
  | { kind: 'gone'; instanceId: string }
  /** Ran as nobody: the pod had no agent it could spawn for this flow, so no
   *  memory was touched and no transcript written. The node trace is the whole
   *  record. */
  | { kind: 'anonymous' }

/**
 * Place a run.
 *
 * `agents` maps agent id to name, or is `null` while the fleet is still
 * loading. That distinction carries weight: an id missing from the roster means
 * the agent was *deleted*, but only once there is a roster to be missing from.
 * Treating "not loaded yet" as "not there" would report every run as orphaned
 * for as long as the request is in flight, and would hide the link on the runs
 * that have one.
 */
export function provenanceOf(run: FlowRun, agents: Map<string, string> | null): RunProvenance {
  const instanceId = run.instance_id
  if (!instanceId) return { kind: 'anonymous' }

  const agentName = agents?.get(instanceId)
  // Known roster, absent id ⇒ deleted. Unknown roster ⇒ unnamed, but still there.
  if (agents && agentName === undefined) return { kind: 'gone', instanceId }

  return run.chat_id
    ? { kind: 'conversation', instanceId, chatId: run.chat_id, agentName }
    : { kind: 'silent', instanceId, agentName }
}

/**
 * Why there is nothing to open — `undefined` when there is, because a link that
 * works needs no excuse beside it.
 */
export function explain(provenance: RunProvenance): string | undefined {
  switch (provenance.kind) {
    case 'conversation': {
      return undefined
    }
    case 'silent': {
      return 'This run wrote no transcript — the pod it ran on kept one only for runs that spoke. It still ran as this agent, and what it did is in that agent’s memory.'
    }
    case 'gone': {
      return 'The agent this ran as has been deleted, and its conversations went with it. The trace below is what is left.'
    }
    case 'anonymous': {
      return 'Run as nobody: this pod has no agent it can start for this automation, so the run kept no memory and left no transcript. Installing an agent pack gives it one.'
    }
  }
}

/** What to call the agent on screen, for a run that has one. */
export function describeAgent(provenance: RunProvenance): string {
  switch (provenance.kind) {
    case 'conversation':
    case 'silent': {
      return provenance.agentName ?? 'this run’s agent'
    }
    case 'gone': {
      return 'an agent this pod no longer has'
    }
    case 'anonymous': {
      return 'nobody'
    }
  }
}
