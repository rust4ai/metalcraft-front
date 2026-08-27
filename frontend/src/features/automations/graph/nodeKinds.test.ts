import { describe, expect, it } from 'vitest'
import { handlesOf, portsOf } from './nodeKinds'

/**
 * The handles an edge can be given. Getting this wrong is not cosmetic: a
 * `branch` whose edges carry no handle is a flow the pod refuses to save, and
 * the names live in the node's payload where the canvas cannot show them.
 */
describe('handlesOf', () => {
  it('reads a branch’s declared outputs, and always offers the error rail', () => {
    const handles = handlesOf('branch', {
      query: 'is it urgent?',
      outputs: [{ handle: 'urgent' }, { handle: 'later' }],
    })
    expect(handles).toEqual(['urgent', 'later', 'error'])
  })

  it('does not offer the error rail twice when a branch declares it', () => {
    const handles = handlesOf('branch', { outputs: [{ handle: 'error' }] })
    expect(handles).toEqual(['error'])
  })

  it('includes a legacy default_handle', () => {
    expect(handlesOf('branch', { outputs: [{ handle: 'a' }], default_handle: 'fallback' })).toContain(
      'fallback',
    )
  })

  it('reads a conditional’s conditions', () => {
    expect(
      handlesOf('conditional', {
        conditions: [{ handle: 'hot', variable: 'x', operator: 'gt', value: 1 }],
      }),
    ).toEqual(['hot'])
  })

  it('defaults an approval to approve/reject and honours explicit choices', () => {
    expect(handlesOf('approval', {})).toEqual(['approve', 'reject'])
    expect(handlesOf('approval', { choices: ['ship', 'hold'] })).toEqual(['ship', 'hold'])
  })

  it('falls back to the type’s fixed vocabulary', () => {
    expect(handlesOf('prompt', {})).toEqual(['ok', 'error'])
    expect(handlesOf('set_variable', {})).toEqual([])
  })

  // A vendor node's handles belong to the vendor; guessing would be worse than
  // the free-text box the inspector keeps for exactly this case.
  it('claims nothing about a vendor node', () => {
    expect(handlesOf('slack:send_message', { channel: '#ops' })).toEqual([])
  })
})

/**
 * Ports are what make a fork wirable by dragging — and what could make an edge
 * vanish, since React Flow drops any edge whose handle matches no port.
 */
describe('portsOf', () => {
  it('draws one port per declared output, plus the error rail', () => {
    expect(portsOf('branch', { outputs: [{ handle: 'yes' }, { handle: 'no' }] }, [])).toEqual([
      'yes',
      'no',
      'error',
    ])
  })

  it('keeps a port for a handle only the edges know about', () => {
    // The case that loses work: an output deleted from the payload while its
    // edge is still in the graph. Without its port the edge would not render,
    // and someone would save a flow with an arc they can no longer see.
    expect(portsOf('branch', { outputs: [{ handle: 'yes' }] }, ['yes', 'gone'])).toEqual([
      'yes',
      'error',
      'gone',
    ])
  })

  it('gives a vendor node the ports its own edges use', () => {
    expect(portsOf('slack:send_message', {}, ['sent'])).toEqual(['sent'])
  })

  it('is one unnamed port for an ordinary step', () => {
    expect(portsOf('set_variable', {}, [])).toEqual([null])
    expect(portsOf('set_variable', {}, [undefined])).toEqual([null])
  })

  it('carries an unlabeled edge alongside named handles', () => {
    // SPEC §5.5: a conditional with no match falls through to the node's
    // unlabeled outgoing edge, so both kinds coexist on one node.
    expect(portsOf('conditional', { conditions: [{ handle: 'hot' }] }, ['hot', undefined])).toEqual([
      'hot',
      null,
    ])
  })

  it('draws nothing on a terminal step', () => {
    expect(portsOf('end', {}, [])).toEqual([])
  })

  it('still draws a port on a terminal step someone wired anyway', () => {
    expect(portsOf('end', {}, [undefined])).toEqual([null])
  })
})
