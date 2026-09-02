import { describe, expect, it, vi } from 'vitest'

/**
 * Drives the real rpc layer over a stubbed transport, the same seam
 * `sessions.test` uses — mocking `@/rpc` as a module replaces the other exports
 * with undefined for everything that loads it afterwards.
 */
async function mount(responses: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: Array<{ method: string; args?: Record<string, unknown> }> = []
  const transport = await import('@/rpc/transport')
  transport.setTransport({
    call: async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args })
      const r = responses[method]
      if (r instanceof Error) throw r
      return r as never
    },
    listen: async () => () => {},
  })
  const { useTurnDebug } = await import('./turnDebug')
  return { useTurnDebug, calls, state: () => useTurnDebug.getState() }
}

/** One turn, one model call, in the envelope a pod actually writes. */
const TRACE = {
  resourceSpans: [
    {
      scopeSpans: [
        {
          spans: [
            {
              spanId: 'a',
              name: 'agent turn 1',
              startTimeUnixNano: '1787755453039815000',
              endTimeUnixNano: '1787755456071228000',
              attributes: [{ key: 'metalcraft.turn.index', value: { intValue: '1' } }],
            },
            {
              spanId: 'b',
              parentSpanId: 'a',
              name: 'chat gpt-5.4',
              startTimeUnixNano: '1787755453854738000',
              endTimeUnixNano: '1787755456071210000',
              attributes: [{ key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } }],
            },
          ],
        },
      ],
    },
  ],
}

const SESSIONS = [
  { id: 'other-agent-run', timestamp: '2026-08-26T15-00-00', instance_id: 'i2', turn_count: 3 },
  { id: 'newest-mine', timestamp: '2026-08-26T14-44-13', instance_id: 'i1', turn_count: 2 },
  { id: 'older-mine', timestamp: '2026-08-20T09-00-00', instance_id: 'i1', turn_count: 9 },
]

describe('turn debug', () => {
  it('reads the run a live turn named, without going looking for one', async () => {
    const { useTurnDebug, calls, state } = await mount({
      pod_diagnostics_trace: TRACE,
      pod_diagnostics_session: { id: 'live-run', timeline: [] },
    })
    await useTurnDebug.getState().load('i1', 'live-run')

    expect(state().sessionId).toBe('live-run')
    // No listing: the turn already said which run it is.
    expect(calls.map((c) => c.method)).not.toContain('pod_diagnostics')
    expect(state().turns).toHaveLength(1)
    // The gap before the first model call — the thing the whole view exists for.
    expect(state().turns![0]!.preludeMs).toBeCloseTo(814.923, 1)
  })

  it('falls back to this agent own newest run, never another agent', async () => {
    // How you get here: something took too long, and you go looking afterwards.
    // The newest run on the pod may well belong to a different agent entirely.
    const { useTurnDebug, state } = await mount({
      pod_diagnostics: SESSIONS,
      pod_diagnostics_trace: TRACE,
      pod_diagnostics_session: { id: 'newest-mine', timeline: [] },
    })
    await useTurnDebug.getState().load('i1')
    expect(state().sessionId).toBe('newest-mine')
  })

  it('says why there is nothing to show rather than drawing an empty timeline', async () => {
    // An empty panel reads as "the agent did nothing", which is never what it means.
    const { useTurnDebug, state } = await mount({ pod_diagnostics: [] })
    await useTurnDebug.getState().load('i1')
    expect(state().turns).toBeNull()
    expect(state().notice).toContain('no recorded runs')
  })

  it('treats a pod too old to be asked the same as one with nothing to show', async () => {
    // `null` from the command is the too-old branch. There is no third panel to
    // draw for it: either way the answer is "nothing to look at here".
    const { useTurnDebug, state } = await mount({ pod_diagnostics: null })
    await useTurnDebug.getState().load('i1')
    expect(state().notice).toContain('no recorded runs')
  })

  it('keeps the messages when a run has no trace', async () => {
    // A run recorded before the pod could trace. The timings are gone; what was
    // sent is not, and that is still worth opening.
    const { useTurnDebug, state } = await mount({
      pod_diagnostics_trace: null,
      pod_diagnostics_session: {
        id: 'old-run',
        timeline: [{ kind: 'llm_request', file: 'llm_request_001.json', data: { a: 1 } }],
      },
    })
    await useTurnDebug.getState().load('i1', 'old-run')
    expect(state().turns).toEqual([])
    expect(state().notice).toContain('no trace')
    expect(state().detail?.timeline).toHaveLength(1)
  })

  it('reports a failed read instead of leaving the panel spinning', async () => {
    const { useTurnDebug, state } = await mount({
      pod_diagnostics_trace: new Error('transport: connection refused'),
      pod_diagnostics_session: { id: 'r', timeline: [] },
    })
    await useTurnDebug.getState().load('i1', 'r')
    expect(state().loading).toBe(false)
    expect(state().notice).toContain('connection refused')
  })
})

describe('two agents, one slot', () => {
  /** A transport whose replies are released by the test, in its chosen order. */
  async function racing() {
    vi.resetModules()
    const gates: Array<{ key: string; resolve: (v: unknown) => void }> = []
    const transport = await import('@/rpc/transport')
    transport.setTransport({
      call: async (method: string, args?: Record<string, unknown>) =>
        new Promise((resolve) => {
          gates.push({ key: `${method}:${JSON.stringify(args ?? {})}`, resolve })
        }) as never,
      listen: async () => () => {},
    })
    const { useTurnDebug } = await import('./turnDebug')
    const release = (match: string, value: unknown) => {
      for (const gate of gates.filter((g) => g.key.includes(match))) gate.resolve(value)
    }
    return { useTurnDebug, release }
  }

  const EMPTY = { resourceSpans: [] }

  it('ignores a read that was overtaken while it was in flight', async () => {
    // The bug this store grew when it stopped being a drawer. A drawer opened
    // once, deliberately; the Runs *mode* re-reads on every navigation, so two
    // loads can be in flight — and the slower one lands last, writing the agent
    // you just left into a panel showing the one you just opened.
    //
    // Awaited rather than tick-counted: an assertion that runs before the stale
    // write lands passes whether or not the guard exists, which is how the first
    // version of this test managed to pass against the bug it was written for.
    const { useTurnDebug, release } = await racing()

    const first = useTurnDebug.getState().load('i1', 'run-a')
    const second = useTurnDebug.getState().load('i2', 'run-b')

    // The newest read owns the slot from the moment it is asked for.
    expect(useTurnDebug.getState().instanceId).toBe('i2')

    // i2 answers with a real trace and settles.
    release('run-b', TRACE)
    await second
    expect(useTurnDebug.getState().turns).toHaveLength(1)

    // Now i1 — long since navigated away from — finally answers, with nothing.
    release('run-a', EMPTY)
    await first

    expect(useTurnDebug.getState().instanceId).toBe('i2')
    // i2's trace, not i1's empty one.
    expect(useTurnDebug.getState().turns).toHaveLength(1)
    expect(useTurnDebug.getState().loading).toBe(false)
  })

  it('does not report a superseded read\'s failure under the current agent', async () => {
    const { useTurnDebug, release } = await racing()
    const first = useTurnDebug.getState().load('i1', 'run-a')
    const second = useTurnDebug.getState().load('i2', 'run-b')

    release('run-b', TRACE)
    await second

    // i1's read blows up after it has been overtaken. Its error belongs to
    // nobody on screen.
    release('run-a', undefined)
    await first
    expect(useTurnDebug.getState().notice).toBe(null)
    expect(useTurnDebug.getState().turns).toHaveLength(1)
  })

  it('names whose runs it is holding', async () => {
    const { useTurnDebug, release } = await racing()
    void useTurnDebug.getState().load('i1', 'run-a')
    expect(useTurnDebug.getState().instanceId).toBe('i1')
    release('run-a', EMPTY)
  })
})
