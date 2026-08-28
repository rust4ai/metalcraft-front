import type { FlowRun } from '@/types'

/**
 * Who a flow run ran as, and where to read what it said.
 *
 * A run is not a log the pod keeps off to one side. Arming a schedule *mints*
 * the agent; every prompt and branch turn then recalls from and writes to that
 * agent's memory, and the first node that actually speaks opens a real
 * conversation there, marking each firing with the flow's name. So "what did my
 * 3am automation do" has a better answer than a node trace — the transcript.
 *
 * Three kinds of run cannot give that answer, which is the whole reason this is
 * a union rather than a nullable id: a tool-only flow deliberately leaves no
 * empty chat behind, an ad-hoc run of an unarmed flow has no agent at all, and
 * an agent can since have been deleted.
 */
export type RunProvenance =
  /** Ran as an agent and wrote a conversation there. Both ids are the way in. */
  | { kind: 'conversation'; instanceId: string; chatId: string; agentName?: string }
  /** Ran as an agent but never reached a node that spoke. Still worth naming and
   *  opening: this run touched that agent's memory. */
  | { kind: 'silent'; instanceId: string; agentName?: string }
  /** Ran as an agent this pod no longer has. Its conversations went with it. */
  | { kind: 'gone'; instanceId: string }
  /** An ad-hoc run of an unarmed flow: no agent, no memory touched, no
   *  transcript. The node trace is the whole record, by design. */
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
      return 'This run never reached a step that spoke, so it wrote no transcript. It still ran as this agent, and what it did is in that agent’s memory.'
    }
    case 'gone': {
      return 'The agent this ran as has been deleted, and its conversations went with it. The trace below is what is left.'
    }
    case 'anonymous': {
      return 'Run by hand, as nobody. An automation gets an agent — and a memory that carries between firings — when you give it a schedule.'
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
