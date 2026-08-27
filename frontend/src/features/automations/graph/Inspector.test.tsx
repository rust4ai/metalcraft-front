import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Inspector } from './Inspector'
import type { FlowNode, SavedFlow } from '@/types'

afterEach(cleanup)

const branch = (data: Record<string, unknown>): FlowNode => ({
  id: 'triage',
  node_type: 'branch',
  data,
  position: [0, 0],
})

const flowWith = (node: FlowNode): SavedFlow =>
  ({
    spec_version: '3',
    id: 'f',
    name: 'F',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    flow: { nodes: [node], edges: [] },
  }) as SavedFlow

function show(node: FlowNode) {
  const onData = vi.fn()
  render(
    <Inspector
      flow={flowWith(node)}
      node={node}
      onData={onData}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  return onData
}

/**
 * A branch's outputs are the part of a flow the *model* reads — the handle it
 * picks between and the description it picks by. They were edited as raw JSON,
 * which is a poor way to write prose.
 */
describe('the branch outputs editor', () => {
  it('adds an output without touching the ones already there', () => {
    const onData = show(branch({ query: 'urgent?', outputs: [{ handle: 'yes' }] }))
    fireEvent.click(screen.getByRole('button', { name: /Add output/ }))
    expect(onData).toHaveBeenCalledWith({ outputs: [{ handle: 'yes' }, { handle: '' }] })
  })

  it('edits one row and leaves the rest of the list alone', () => {
    const onData = show(
      branch({ query: 'urgent?', outputs: [{ handle: 'yes' }, { handle: 'no' }] }),
    )
    const second = screen.getAllByLabelText('Handle')[1]!
    fireEvent.change(second, { target: { value: 'later' } })
    fireEvent.blur(second)
    expect(onData).toHaveBeenCalledWith({ outputs: [{ handle: 'yes' }, { handle: 'later' }] })
  })

  // The module's whole promise: a pod a version ahead can put a field on a row
  // this build has never heard of, and editing the fields it does know must not
  // be what deletes it.
  it('keeps a row field this build does not know', () => {
    const onData = show(
      branch({ query: 'q', outputs: [{ handle: 'yes', weight_from_a_newer_pod: 3 }] }),
    )
    const description = screen.getByLabelText('When to pick it')
    fireEvent.change(description, { target: { value: 'it is urgent' } })
    fireEvent.blur(description)
    expect(onData).toHaveBeenCalledWith({
      outputs: [{ handle: 'yes', weight_from_a_newer_pod: 3, description: 'it is urgent' }],
    })
  })

  it('takes a payload schema as JSON and keeps its type', () => {
    const onData = show(branch({ query: 'q', outputs: [{ handle: 'yes' }] }))
    const schema = screen.getByLabelText('Payload')
    fireEvent.change(schema, { target: { value: '{"type":"integer"}' } })
    fireEvent.blur(schema)
    expect(onData).toHaveBeenCalledWith({
      outputs: [{ handle: 'yes', schema: { type: 'integer' } }],
    })
  })

  it('refuses a schema that is not JSON rather than saving the text', () => {
    const onData = show(branch({ query: 'q', outputs: [{ handle: 'yes' }] }))
    const schema = screen.getByLabelText('Payload')
    fireEvent.change(schema, { target: { value: '{type: integer' } })
    fireEvent.blur(schema)
    expect(onData).not.toHaveBeenCalled()
  })

  it('removes the row that was asked for', () => {
    const onData = show(
      branch({ query: 'q', outputs: [{ handle: 'yes' }, { handle: 'no' }] }),
    )
    fireEvent.click(screen.getAllByTitle('Remove this output')[0]!)
    expect(onData).toHaveBeenCalledWith({ outputs: [{ handle: 'no' }] })
  })

  it('offers the row editor even when the node has no outputs key at all', () => {
    show(branch({ query: 'q' }))
    expect(screen.getByRole('button', { name: /Add output/ })).toBeTruthy()
  })
})

describe('the conditional editor', () => {
  const conditional = (data: Record<string, unknown>): FlowNode => ({
    id: 'route',
    node_type: 'conditional',
    data,
    position: [0, 0],
  })

  it('offers the operators in the pod’s own spelling', () => {
    show(conditional({ conditions: [{ variable: '_last', operator: 'equals', handle: 'hot' }] }))
    const select = screen.getByLabelText('Is') as HTMLSelectElement
    const options = [...select.options].map((o) => o.value)
    expect(options).toContain('not_equals')
    expect(options).toContain('starts_with')
    expect(options).toContain('truthy')
  })

  it('starts a new condition at something that runs', () => {
    const onData = show(conditional({ conditions: [] }))
    fireEvent.click(screen.getByRole('button', { name: /Add condition/ }))
    expect(onData).toHaveBeenCalledWith({
      conditions: [{ variable: '_last', operator: 'equals', value: '', handle: '' }],
    })
  })

  // `value` is `any` in the spec: a condition comparing against 3 must not
  // quietly become one comparing against "3".
  it('keeps a comparison value’s type', () => {
    const onData = show(
      conditional({ conditions: [{ variable: 'n', operator: 'gt', value: '', handle: 'big' }] }),
    )
    const value = screen.getByLabelText('Value')
    fireEvent.change(value, { target: { value: '3' } })
    fireEvent.blur(value)
    expect(onData).toHaveBeenCalledWith({
      conditions: [{ variable: 'n', operator: 'gt', value: 3, handle: 'big' }],
    })
  })
})
