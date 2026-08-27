import { describe, expect, it } from 'vitest'
import { hasAuthoredLayout, layout, positions } from './layout'
import type { FlowDefinition, FlowNode } from '@/types'

const node = (id: string, node_type = 'prompt', position?: [number, number]): FlowNode => ({
  id,
  node_type,
  data: {},
  position,
})

const def = (nodes: FlowNode[], edges: Array<[string, string]>): FlowDefinition => ({
  nodes,
  edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
})

describe('hasAuthoredLayout', () => {
  it('treats every node sitting on the origin as no layout at all', () => {
    // The common case by far: `position` defaults to [0,0] and everything the
    // pod authors leaves it there. Honouring it renders one stacked blob.
    expect(hasAuthoredLayout([node('a'), node('b'), node('c')])).toBe(false)
  })

  it('honours real coordinates', () => {
    expect(hasAuthoredLayout([node('a', 'entry', [0, 0]), node('b', 'prompt', [250, 0])])).toBe(true)
  })

  it('does not need coordinates for a single node', () => {
    // One node cannot overlap itself, so [0,0] is a perfectly good answer.
    expect(hasAuthoredLayout([node('a')])).toBe(true)
    expect(hasAuthoredLayout([])).toBe(true)
  })
})

describe('layout', () => {
  it('ranks nodes by their distance from the entry', () => {
    const placed = layout(
      def(
        [node('entry', 'entry'), node('one'), node('two')],
        [
          ['entry', 'one'],
          ['one', 'two'],
        ],
      ),
    )
    const x = (id: string) => placed.get(id)?.x ?? 0
    expect(x('entry')).toBeLessThan(x('one'))
    expect(x('one')).toBeLessThan(x('two'))
    // A straight line should read as one: same row, no drift.
    expect(placed.get('entry')?.y).toBe(placed.get('two')?.y)
  })

  it('spreads a branch’s outcomes across one rank', () => {
    const placed = layout(
      def(
        [node('entry', 'entry'), node('pick', 'branch'), node('yes'), node('no')],
        [
          ['entry', 'pick'],
          ['pick', 'yes'],
          ['pick', 'no'],
        ],
      ),
    )
    expect(placed.get('yes')?.x).toBe(placed.get('no')?.x)
    expect(placed.get('yes')?.y).not.toBe(placed.get('no')?.y)
    // Centred on the node they came from, so a branch looks like a fork.
    expect((placed.get('yes')!.y + placed.get('no')!.y) / 2).toBe(placed.get('pick')?.y)
  })

  it('terminates on a cycle', () => {
    // The spec allows cycles (§4.1) and requires runtimes to track a visited
    // set. Without one this test hangs rather than fails, which is why it is
    // here at all.
    const placed = layout(
      def(
        [node('entry', 'entry'), node('a'), node('b')],
        [
          ['entry', 'a'],
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    )
    expect(placed.size).toBe(3)
  })

  it('still places a node the entry cannot reach', () => {
    // §4.1: an editor may legitimately hold disconnected scratch nodes. A node
    // that cannot be seen cannot be reconnected.
    const placed = layout(def([node('entry', 'entry'), node('orphan')], []))
    expect(placed.has('orphan')).toBe(true)
    expect(placed.get('orphan')?.x).toBeGreaterThan(placed.get('entry')!.x)
  })

  it('ignores an edge pointing at a node that is not there', () => {
    // Invalid, and the pod would refuse to save it — but a viewer opens what it
    // is given, and throwing here would blank the whole graph over one bad edge.
    const placed = layout(def([node('entry', 'entry'), node('a')], [['entry', 'ghost']]))
    expect(placed.size).toBe(2)
  })

  it('lays out a graph with no entry node at all', () => {
    // Valid per §5.3 — a template or fragment. It cannot run, but it must draw.
    const placed = layout(def([node('a'), node('b')], [['a', 'b']]))
    expect(placed.get('a')?.x).toBeLessThan(placed.get('b')!.x)
  })

  it('orders a rank by document order, not traversal order', () => {
    // Stability across reloads: the same flow must not reshuffle its rows
    // because a Map iterated differently.
    const nodes = [node('entry', 'entry'), node('b'), node('a')]
    const edges: Array<[string, string]> = [
      ['entry', 'a'],
      ['entry', 'b'],
    ]
    const placed = layout(def(nodes, edges))
    expect(placed.get('b')!.y).toBeLessThan(placed.get('a')!.y)
  })
})

describe('positions', () => {
  it('prefers the flow’s own coordinates', () => {
    const placed = positions(
      def([node('entry', 'entry', [10, 20]), node('a', 'prompt', [99, 5])], [['entry', 'a']]),
    )
    expect(placed.get('a')).toMatchObject({ x: 99, y: 5 })
  })

  it('computes when there are none', () => {
    const placed = positions(def([node('entry', 'entry'), node('a')], [['entry', 'a']]))
    expect(placed.get('a')!.x).toBeGreaterThan(0)
  })
})
