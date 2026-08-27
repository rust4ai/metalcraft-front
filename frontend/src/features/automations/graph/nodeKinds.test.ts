import { describe, expect, it } from 'vitest'
import { handlesOf } from './nodeKinds'

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
