import { describe, expect, it } from 'vitest'
import { collectInputs, declaredInputs, initialText, unfilled } from './flowInputs'
import type { SavedFlow } from '@/types'

const flow = (entryData: unknown): SavedFlow => ({
  spec_version: '3',
  id: 'f',
  name: 'F',
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
  flow: {
    nodes: [{ id: 'entry', node_type: 'entry', data: entryData }],
    edges: [],
  },
})

describe('what a flow asks for', () => {
  it('reads the entry node’s declared inputs', () => {
    const inputs = declaredInputs(
      flow({
        inputs: {
          repo: { type: 'string', required: true },
          hours: { type: 'integer', required: false, default: 24 },
        },
      }),
    )
    expect(inputs).toEqual([
      { name: 'repo', type: 'string', required: true, default: undefined },
      { name: 'hours', type: 'integer', required: false, default: 24 },
    ])
  })

  it('asks for nothing when the flow declares nothing', () => {
    // The common case, and the one where Run must stay a single click.
    expect(declaredInputs(flow({}))).toEqual([])
    expect(declaredInputs(flow({ persona: 'calcom-agent' }))).toEqual([])
  })

  it('survives an entry node that is nothing like the spec', () => {
    // A pod is rolled independently of this app, and a flow can be hand-written.
    // Neither is a reason to throw on a screen that only wanted to know what to
    // ask for.
    expect(declaredInputs(flow(null))).toEqual([])
    expect(declaredInputs(flow({ inputs: 'nonsense' }))).toEqual([])
    expect(declaredInputs(flow({ inputs: { odd: 7 } }))).toEqual([
      { name: 'odd', type: 'string', required: false, default: undefined },
    ])
  })

  it('starts a field at the declared default, as text', () => {
    expect(initialText({ name: 'a', type: 'string', required: false, default: 'hi' })).toBe('hi')
    expect(initialText({ name: 'n', type: 'integer', required: false, default: 24 })).toBe('24')
    expect(initialText({ name: 'x', type: 'string', required: true })).toBe('')
  })
})

describe('what gets sent', () => {
  const inputs = [
    { name: 'repo', type: 'string', required: true },
    { name: 'hours', type: 'integer', required: false, default: 24 },
    { name: 'dry_run', type: 'boolean', required: false },
    { name: 'extra', type: 'object', required: false },
  ]

  it('keeps each declared type, so a whole {{ref}} stays what it was', () => {
    // The pod adopts the referenced value's JSON type for a whole-string
    // reference: `{"limit": "{{hours}}"}` sends the number only if this did.
    expect(
      collectInputs(inputs, {
        repo: 'rust4ai/metalcraft-agent',
        hours: '12',
        dry_run: 'true',
        extra: '{"depth":2}',
      }),
    ).toEqual({
      repo: 'rust4ai/metalcraft-agent',
      hours: 12,
      dry_run: true,
      extra: { depth: 2 },
    })
  })

  it('omits an empty field rather than sending an empty one', () => {
    // Absent means "use the declared default". Sending "" would override the
    // default with nothing — turning a field nobody touched into a blank one.
    expect(collectInputs(inputs, { repo: 'acme/app', hours: '  ' })).toEqual({ repo: 'acme/app' })
  })

  it('sends unparseable text as text and lets the pod object', () => {
    expect(collectInputs(inputs, { hours: 'soon', extra: '{oops' })).toEqual({
      hours: 'soon',
      extra: '{oops',
    })
  })

  it('does not trim a string, which is somebody’s wording', () => {
    expect(collectInputs(inputs, { repo: ' acme/app ' })).toEqual({ repo: ' acme/app ' })
  })

  it('names the required inputs still unfilled, defaults excluded', () => {
    expect(unfilled(inputs, {})).toEqual(['repo'])
    expect(unfilled(inputs, { repo: 'acme/app' })).toEqual([])
  })
})
