import { describe, expect, it } from 'vitest'
import { formatDuration, formatTokens, readTrace } from './turnTrace'

/**
 * The span ids, timestamps and attribute encodings below are copied from a trace
 * a real pod wrote (`GET /api/v1/diagnostics/{id}/trace`, agent 0.32.0), not
 * invented from the pod's source. That is what makes this a test of the wire
 * format rather than a test of my reading of it — `intValue` arriving as the
 * *string* `"1"` is exactly the kind of detail a hand-made fixture gets wrong.
 *
 * The run: one turn, a model call that failed against a stub, and — the reason
 * this fixture is interesting — 815ms of untraced work before the model was
 * reached at all.
 */
const REAL_TRACE = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'metalcraft-agent' } }] },
      scopeSpans: [
        {
          scope: { name: 'metalcraft-agent.trace', version: '0.32.0' },
          spans: [
            {
              spanId: '6d2d954add8e49f0',
              name: 'chat session',
              startTimeUnixNano: '1787755453011263000',
              endTimeUnixNano: '1787755456071229000',
              attributes: [{ key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } }],
              status: { code: 0, message: '' },
            },
            {
              spanId: '3c6ef372fe94f82a',
              parentSpanId: '9e3779b97f4a7c15',
              name: 'chat gpt-5.4',
              startTimeUnixNano: '1787755453854738000',
              endTimeUnixNano: '1787755456071210000',
              attributes: [
                { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } },
              ],
              events: [
                {
                  name: 'exception',
                  timeUnixNano: '1787755456071200000',
                  attributes: [{ key: 'exception.message', value: { stringValue: 'HttpError: 500' } }],
                },
              ],
              status: { code: 2, message: 'node error' },
            },
            {
              spanId: '9e3779b97f4a7c15',
              parentSpanId: '6d2d954add8e49f0',
              name: 'agent turn 1',
              startTimeUnixNano: '1787755453039815000',
              endTimeUnixNano: '1787755456071228000',
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'invoke_agent' } },
                { key: 'metalcraft.turn.index', value: { intValue: '1' } },
              ],
              events: [
                {
                  name: 'gen_ai.user.message',
                  timeUnixNano: '1787755453039900000',
                  attributes: [
                    { key: 'content', value: { stringValue: 'clone the repo into a workspace' } },
                  ],
                },
              ],
              status: { code: 2, message: 'node error' },
            },
          ],
        },
      ],
    },
  ],
}

describe('readTrace', () => {
  it('reads a real pod trace into one entry per turn', () => {
    const [turn, ...rest] = readTrace(REAL_TRACE)
    expect(rest).toHaveLength(0)
    expect(turn).toBeTruthy()
    expect(turn!.index).toBe(1) // `intValue: "1"` — a string on the wire
    expect(turn!.message).toBe('clone the repo into a workspace')
    expect(turn!.failed).toBe(true)

    const [step] = turn!.steps
    expect(step!.kind).toBe('model')
    expect(step!.label).toBe('gpt-5.4') // the model, not the span name
    expect(step!.failed).toBe(true)
    // A failed step is read for its cause, so that is what it carries.
    expect(step!.detail).toBe('HttpError: 500')
  })

  it('surfaces the untraced work before the first model call', () => {
    // The reason this parser exists. Compaction and recall have no spans, so
    // the only evidence they ran is the gap between the turn starting and its
    // first child — 815ms here, minutes on the turn that prompted all this.
    const [turn] = readTrace(REAL_TRACE)
    expect(turn!.preludeMs).toBeCloseTo(814.923, 1)
    expect(turn!.durationMs).toBeCloseTo(3031.413, 1)
  })

  it('keeps sub-millisecond precision that Number() would lose', () => {
    // Unix nanos are ~1.8e18, two hundred times past MAX_SAFE_INTEGER. Parsed
    // as numbers first, both of these round to the same float and the step
    // measures 0ms.
    const [turn] = readTrace(withSpan({
      spanId: 'b',
      parentSpanId: 'a',
      name: 'execute_tool bash',
      startTimeUnixNano: '1787755453039815000',
      endTimeUnixNano: '1787755453040938000',
      attributes: [{ key: 'gen_ai.tool.name', value: { stringValue: 'bash' } }],
    }))
    expect(turn!.steps[0]!.durationMs).toBeCloseTo(1.123, 2)
  })

  it('reads token usage off a model call', () => {
    const [turn] = readTrace(withSpan({
      spanId: 'b',
      parentSpanId: 'a',
      name: 'chat gpt-5.4',
      startTimeUnixNano: '1787755453039815000',
      endTimeUnixNano: '1787755455039815000',
      attributes: [
        { key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } },
        { key: 'gen_ai.usage.input_tokens', value: { intValue: '48210' } },
        { key: 'gen_ai.usage.output_tokens', value: { intValue: '120' } },
        { key: 'gen_ai.usage.cache_read.input_tokens', value: { intValue: '44000' } },
      ],
    }))
    expect(turn!.steps[0]!.tokens).toMatchObject({ input: 48_210, output: 120, cached: 44_000 })
  })

  it('gives back nothing rather than throwing on a document it cannot read', () => {
    // A pod with no trace, a truncated file, a shape a newer pod invented. A
    // debug view that throws is worth less than one that shows what it could.
    for (const junk of [null, undefined, {}, { resourceSpans: 'nope' }, [], 42]) {
      expect(readTrace(junk)).toEqual([])
    }
  })

  it('treats a turn that never reached the model as all prelude', () => {
    // What a turn killed during compaction looks like — and the shape that would
    // otherwise report a six-minute turn as six minutes of nothing in particular.
    const [turn] = readTrace(withSpan(undefined))
    expect(turn!.steps).toEqual([])
    expect(turn!.preludeMs).toBe(turn!.durationMs)
  })
})

describe('formatting', () => {
  it('picks the scale a reader wants at each size', () => {
    expect(formatDuration(340)).toBe('340ms')
    expect(formatDuration(1400)).toBe('1.4s')
    expect(formatDuration(126_000)).toBe('2m 06s')
    expect(formatDuration(360_000)).toBe('6m 00s')
  })

  it('reads token counts for magnitude', () => {
    expect(formatTokens(840)).toBe('840')
    expect(formatTokens(12_400)).toBe('12.4k')
  })
})

/** One turn span (`a`), plus an optional child, in the real envelope. */
function withSpan(child: Record<string, unknown> | undefined) {
  const turn = {
    spanId: 'a',
    name: 'agent turn 1',
    startTimeUnixNano: '1787755453039815000',
    endTimeUnixNano: '1787755456071228000',
    attributes: [{ key: 'metalcraft.turn.index', value: { intValue: '1' } }],
    status: { code: 0, message: '' },
  }
  return {
    resourceSpans: [{ scopeSpans: [{ spans: child ? [turn, child] : [turn] }] }],
  }
}
