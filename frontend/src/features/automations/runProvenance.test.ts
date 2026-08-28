import { describe, expect, it } from 'vitest'
import { describeAgent, explain, provenanceOf } from './runProvenance'
import type { FlowRun } from '@/types'

const run = (instance_id?: string | null, chat_id?: string | null): FlowRun => ({
  id: 'run-1',
  flow_id: 'morning-brief',
  status: 'completed',
  current_node_id: 'brief',
  instance_id,
  chat_id,
  warnings: [],
  created_at: '2026-08-27T03:00:00Z',
  updated_at: '2026-08-27T03:00:04Z',
})

const roster = new Map([['inst-1', 'Morning briefer']])

describe('provenanceOf', () => {
  it('offers the conversation an armed run wrote', () => {
    const p = provenanceOf(run('inst-1', 'chat-9'), roster)
    expect(p).toEqual({
      kind: 'conversation',
      instanceId: 'inst-1',
      chatId: 'chat-9',
      agentName: 'Morning briefer',
    })
    // A working link needs no excuse printed beside it.
    expect(explain(p)).toBeUndefined()
  })

  it('still names the agent of a run the pod kept no conversation for', () => {
    // Runs from an older pod, which opened a chat only for a run that spoke. It
    // did run as somebody, and it did touch that agent's memory.
    const p = provenanceOf(run('inst-1', null), roster)
    expect(p).toEqual({ kind: 'silent', instanceId: 'inst-1', agentName: 'Morning briefer' })
    expect(explain(p)).toBeDefined()
  })

  it('calls a run the pod had no agent for nobody', () => {
    const p = provenanceOf(run(null, null), roster)
    expect(p).toEqual({ kind: 'anonymous' })
    expect(describeAgent(p)).toBe('nobody')
  })

  it('does not trust a chat id with no agent behind it', () => {
    // The pod does not write one, and a run with no instance has no agent to
    // open the conversation *in* — following the chat id alone would open a
    // session screen with nothing to address it to.
    expect(provenanceOf(run(null, 'chat-9'), roster)).toEqual({ kind: 'anonymous' })
  })

  it('reports an agent missing from a loaded roster as gone', () => {
    const p = provenanceOf(run('inst-x', 'chat-9'), roster)
    // Nothing to open: deleting an agent takes its conversations with it.
    expect(p).toEqual({ kind: 'gone', instanceId: 'inst-x' })
    expect(explain(p)).toBeDefined()
  })

  it('does not mistake an unloaded fleet for an absent agent', () => {
    // The whole reason `agents` is nullable. Reading "not in the list" as
    // "deleted" would report every run as orphaned while the request is in
    // flight, and hide the link on the runs that have one.
    const p = provenanceOf(run('inst-1', 'chat-9'), null)
    expect(p).toEqual({
      kind: 'conversation',
      instanceId: 'inst-1',
      chatId: 'chat-9',
      agentName: undefined,
    })
    expect(describeAgent(p)).toBe('this run’s agent')
  })

  it('places a silent run without a roster too', () => {
    expect(provenanceOf(run('inst-1', null), null)).toEqual({
      kind: 'silent',
      instanceId: 'inst-1',
      agentName: undefined,
    })
  })

  it('treats an empty roster as loaded, not as pending', () => {
    // `new Map()` is a pod with no agents at all, which is a fact rather than a
    // request still in flight. A run naming one must not be offered as openable.
    expect(provenanceOf(run('inst-1', 'chat-9'), new Map())).toEqual({
      kind: 'gone',
      instanceId: 'inst-1',
    })
  })
})
