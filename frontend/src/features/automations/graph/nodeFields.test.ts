import { describe, expect, it } from 'vitest'
import { addableFields, newNodeData, typedFields, untypedKeys } from './nodeFields'

/**
 * The inspector can only edit what it offers. Two ways a field goes missing:
 * the node was added without the key (and the JSON editor shows only keys that
 * exist), or a typed control was handed a value it cannot represent.
 */
describe('newNodeData', () => {
  it('seeds the payloads the pod parses structurally', () => {
    expect(newNodeData('branch')).toMatchObject({ query: '' })
    expect(newNodeData('conditional')).toEqual({ conditions: [] })
  })

  it('writes down the defaults the canvas already assumes', () => {
    expect(newNodeData('http')).toEqual({ method: 'GET' })
    expect(newNodeData('foreach')).toEqual({ mode: 'sequential' })
  })

  it('leaves a type with no required payload alone', () => {
    expect(newNodeData('wait')).toEqual({})
    expect(newNodeData('slack:send_message')).toEqual({})
  })
})

describe('addableFields', () => {
  // The audit case: a fresh `tool` node had no control for `args` and no key to
  // edit, so a tool could be called from this editor but never with arguments.
  it('offers a spec field that has no typed control', () => {
    expect(addableFields('tool', { tool_name: 'send' }).map(([k]) => k)).toEqual(['args'])
    expect(addableFields('http', { method: 'GET' }).map(([k]) => k)).toEqual(['headers', 'body'])
    expect(addableFields('entry', {}).map(([k]) => k)).toEqual(['inputs'])
    expect(addableFields('end', {}).map(([k]) => k)).toEqual(['outputs'])
  })

  it('stops offering a field once it is set', () => {
    expect(addableFields('tool', { tool_name: 'send', args: { to: 'x' } })).toEqual([])
  })

  it('starts a field at a shape worth editing, not at null', () => {
    expect(Object.fromEntries(addableFields('approval', {}))).toEqual({
      choices: ['approve', 'reject'],
    })
  })

  it('claims nothing about a vendor node', () => {
    expect(addableFields('slack:send_message', {})).toEqual([])
  })
})

describe('typed controls only for values they can show', () => {
  // A text box given an object renders `[object Object]` and writes that back on
  // blur — the one thing this editor exists to never do.
  it('sends an object-valued field to the JSON editor instead', () => {
    const data = { url: { from: 'a newer pod' }, method: 'GET' }
    expect(typedFields('http', data).map((f) => f.key)).not.toContain('url')
    expect(untypedKeys('http', data)).toContain('url')
  })

  it('keeps the control when the value is one a control can show', () => {
    const data = { url: 'https://example.com', method: 'GET' }
    expect(typedFields('http', data).map((f) => f.key)).toContain('url')
    expect(untypedKeys('http', data)).toEqual([])
  })

  // `set_variable.value` is `any` in the spec: its own control handles every
  // type, so it never falls through however it is filled in.
  it('leaves an any-typed field with its own control', () => {
    expect(typedFields('set_variable', { variable: 'n', value: { a: 1 } }).map((f) => f.key)).toContain(
      'value',
    )
    expect(untypedKeys('set_variable', { variable: 'n', value: { a: 1 } })).toEqual([])
  })
})
