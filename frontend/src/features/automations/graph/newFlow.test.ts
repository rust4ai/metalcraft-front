import { describe, expect, it } from 'vitest'
import { blankFlow, copyFlow, freeFlowId, slugify } from './newFlow'

const NOW = '2026-08-27T12:00:00Z'

describe('slugify', () => {
  it('makes a name into an id the pod will accept', () => {
    // The pod enforces ^[A-Za-z0-9-]{1,64}$ and answers 400 otherwise, which
    // would surface as "save failed" on a name that looked perfectly fine.
    expect(slugify('Morning Brief')).toBe('morning-brief')
    expect(slugify('  Ops: page #1!  ')).toBe('ops-page-1')
    expect(slugify('a'.repeat(80))).toHaveLength(64)
  })

  it('never returns nothing', () => {
    // An empty id is a 400, and "rename this" is a better thing to be told.
    expect(slugify('!!!')).toBe('flow')
    expect(slugify('')).toBe('flow')
  })
})

describe('freeFlowId', () => {
  it('avoids an id already on the pod', () => {
    expect(freeFlowId('Brief', ['brief'])).toBe('brief-2')
    expect(freeFlowId('Brief', ['brief', 'brief-2'])).toBe('brief-3')
  })

  it('uses the plain id when it is free', () => {
    expect(freeFlowId('Brief', [])).toBe('brief')
  })
})

describe('blankFlow', () => {
  it('starts with an entry node rather than an empty canvas', () => {
    // A flow with no entry is legal as a fragment but cannot run. Making
    // someone's first discovery be "you needed an entry" is a worse start than
    // one step they can see.
    const f = blankFlow('Morning Brief', [], NOW)
    expect(f.flow.nodes).toHaveLength(1)
    expect(f.flow.nodes[0]?.node_type).toBe('entry')
    expect(f.flow.edges).toHaveLength(0)
  })

  it('declares the spec version it was authored against', () => {
    expect(blankFlow('x', [], NOW).spec_version).toBe('3')
  })
})

describe('copyFlow', () => {
  const template = {
    spec_version: '3',
    id: 'shipped-template',
    name: 'Shipped',
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    a_field_from_a_newer_pod: true,
    requires: { packs: [{ id: 'slack' }] },
    flow: {
      nodes: [
        { id: 'entry', node_type: 'entry', data: {}, position: [0, 0] },
        { id: 'post', node_type: 'slack:send_message', data: { channel: '#ops' } },
      ],
      edges: [{ id: 'e1', source: 'entry', target: 'post' }],
    },
  }

  it('takes the whole document, including what it cannot read', () => {
    // A template shipped by a pack newer than this app must be copied whole. A
    // copy reduced to the fields `SavedFlow` names would quietly ship a
    // different automation than the one advertised.
    const copy = copyFlow(template, 'My Brief', [], NOW) as unknown as Record<string, unknown>
    expect(copy.a_field_from_a_newer_pod).toBe(true)
    expect(copy.requires).toEqual({ packs: [{ id: 'slack' }] })
    const nodes = (copy.flow as { nodes: Array<Record<string, unknown>> }).nodes
    expect(nodes[1]?.data).toEqual({ channel: '#ops' })
  })

  it('replaces only what is about this copy', () => {
    const copy = copyFlow(template, 'My Brief', ['my-brief'], NOW)
    expect(copy.name).toBe('My Brief')
    expect(copy.id).toBe('my-brief-2')
    expect(copy.created_at).toBe(NOW)
    expect(copy.updated_at).toBe(NOW)
  })

  it('does not disturb the original', () => {
    const before = JSON.stringify(template)
    copyFlow(template, 'My Brief', [], NOW)
    expect(JSON.stringify(template)).toBe(before)
  })
})
