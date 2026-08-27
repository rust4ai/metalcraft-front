import { describe, expect, it } from 'vitest'
import {
  addNode,
  apply,
  connect,
  deleteEdge,
  deleteNode,
  editNodeData,
  freshNodeId,
  historyOf,
  localProblems,
  moveNode,
  redo,
  renameNode,
  setEdgeHandle,
  undo,
} from './edit'
import type { SavedFlow } from '@/types'

/**
 * A flow carrying things this build does not understand: a vendor node with a
 * nested payload, an unknown field on a node, and an unknown field on the
 * document. Every test below edits *around* them.
 */
const flow = (): SavedFlow =>
  JSON.parse(
    JSON.stringify({
      spec_version: '3',
      id: 'notify',
      name: 'Notify',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      a_field_from_a_newer_pod: true,
      flow: {
        nodes: [
          { id: 'entry', node_type: 'entry', data: {}, position: [0, 0] },
          {
            id: 'post',
            node_type: 'slack:send_message',
            retries: 3,
            data: { channel: '#ops', blocks: [{ type: 'section' }], unfurl: false },
            position: [250, 0],
          },
        ],
        edges: [{ id: 'e1', source: 'entry', target: 'post', source_handle: 'ok' }],
      },
    }),
  ) as SavedFlow

const node = (f: SavedFlow, id: string) => f.flow.nodes.find((n) => n.id === id)

describe('edits keep what they do not understand', () => {
  // The property the whole module exists for. SPEC §5.2 requires a vendor
  // node's data to round-trip verbatim, and a pod a version ahead of this app
  // can put fields anywhere. An editor that rebuilt objects from known fields
  // would delete all of it on the first save, silently, for everyone.

  it('moving a node keeps its unknown fields and payload', () => {
    const moved = moveNode(flow(), 'post', [400, 80])
    const post = node(moved, 'post') as unknown as Record<string, unknown>
    expect(post.position).toEqual([400, 80])
    expect(post.retries).toBe(3)
    expect(post.data).toEqual({ channel: '#ops', blocks: [{ type: 'section' }], unfurl: false })
  })

  it('editing one data key keeps the others', () => {
    const edited = editNodeData(flow(), 'post', { channel: '#alerts' })
    expect(node(edited, 'post')?.data).toEqual({
      channel: '#alerts',
      blocks: [{ type: 'section' }],
      unfurl: false,
    })
  })

  it('keeps unknown document fields through any edit', () => {
    const edited = moveNode(flow(), 'entry', [10, 10]) as unknown as Record<string, unknown>
    expect(edited.a_field_from_a_newer_pod).toBe(true)
  })

  it('leaves untouched nodes identical', () => {
    const before = flow()
    const after = moveNode(before, 'entry', [5, 5])
    // Not merely equal — the *same object*, so nothing can have been rewritten.
    expect(node(after, 'post')).toBe(node(before, 'post'))
  })
})

describe('nodes', () => {
  it('names a new node after its type, and never collides', () => {
    const one = addNode(flow(), 'prompt', [0, 0])
    expect(node(one, 'prompt')).toBeTruthy()
    const two = addNode(one, 'prompt', [0, 0])
    expect(two.flow.nodes.filter((n) => n.node_type === 'prompt')).toHaveLength(2)
    expect(node(two, 'prompt-2')).toBeTruthy()
    expect(freshNodeId(two, 'prompt')).toBe('prompt-3')
  })

  it('names a vendor node after the part that means something', () => {
    const added = addNode(flow(), 'github:open_pr', [0, 0])
    expect(node(added, 'open_pr')).toBeTruthy()
  })

  // A branch added with an empty payload is refused by the pod on sight
  // ("expected branch data: missing field `query`"), and its outputs list —
  // edited as JSON — could not even be typed, because the JSON editor only
  // shows keys that already exist.
  it('a new branch starts with the payload the pod requires', () => {
    const added = addNode(flow(), 'branch', [0, 0])
    const data = node(added, 'branch')?.data as Record<string, unknown>
    expect(data).toHaveProperty('query')
    expect(Array.isArray(data.outputs)).toBe(true)
    expect((data.outputs as Array<{ handle: string }>).length).toBeGreaterThan(0)
  })

  it('a new conditional starts with a conditions list', () => {
    const added = addNode(flow(), 'conditional', [0, 0])
    const data = node(added, 'conditional')?.data as Record<string, unknown>
    expect(data.conditions).toEqual([])
  })

  it('a type with no required payload still starts empty', () => {
    expect(node(addNode(flow(), 'wait', [0, 0]), 'wait')?.data).toEqual({})
  })

  it('deleting a node takes its edges with it', () => {
    const gone = deleteNode(flow(), 'post')
    expect(gone.flow.nodes.map((n) => n.id)).toEqual(['entry'])
    // An edge to a node that is gone is a dangling reference the pod refuses to
    // save, and nothing on the canvas would explain the refusal.
    expect(gone.flow.edges).toHaveLength(0)
  })

  it('renaming carries the edges that pointed at it', () => {
    const renamed = renameNode(flow(), 'post', 'notify-ops')
    expect(node(renamed, 'notify-ops')).toBeTruthy()
    expect(renamed.flow.edges[0]).toMatchObject({ source: 'entry', target: 'notify-ops' })
  })

  it('refuses a rename onto a name already taken', () => {
    const before = flow()
    expect(renameNode(before, 'post', 'entry')).toBe(before)
    expect(renameNode(before, 'post', '')).toBe(before)
  })
})

describe('edges', () => {
  it('connects two nodes', () => {
    const linked = connect(addNode(flow(), 'end', [500, 0]), 'post', 'end')
    expect(linked.flow.edges).toHaveLength(2)
    expect(linked.flow.edges[1]).toMatchObject({ source: 'post', target: 'end' })
  })

  it('refuses a duplicate arc', () => {
    // Same source, target and handle changes nothing about the run and is
    // invisible on the canvas, so it can only be a slip of the mouse.
    const before = flow()
    expect(connect(before, 'entry', 'post', 'ok')).toBe(before)
    // A *different* handle between the same pair is a real second route.
    expect(connect(before, 'entry', 'post', 'error').flow.edges).toHaveLength(2)
  })

  it('refuses an edge to a node that is not there', () => {
    const before = flow()
    expect(connect(before, 'entry', 'ghost')).toBe(before)
  })

  it('sets and clears which output an edge leaves from', () => {
    const cleared = setEdgeHandle(flow(), 'e1', undefined)
    expect(cleared.flow.edges[0]).not.toHaveProperty('source_handle')
    const set = setEdgeHandle(cleared, 'e1', 'error')
    expect(set.flow.edges[0]?.source_handle).toBe('error')
  })

  it('deletes one edge and leaves the nodes', () => {
    const gone = deleteEdge(flow(), 'e1')
    expect(gone.flow.edges).toHaveLength(0)
    expect(gone.flow.nodes).toHaveLength(2)
  })
})

describe('localProblems', () => {
  it('says nothing about a healthy flow', () => {
    expect(localProblems(flow())).toEqual([])
  })

  it('catches a second entry node', () => {
    const two = addNode(flow(), 'entry', [0, 100])
    expect(localProblems(two)[0]).toContain('entry')
  })

  it('catches an edge pointing at nothing', () => {
    const broken = flow()
    broken.flow.edges = broken.flow.edges.map((e) => ({ ...e, target: 'ghost' }))
    expect(localProblems(broken).join(' ')).toContain('ghost')
  })
})

describe('history', () => {
  it('walks back and forward through edits', () => {
    let h = historyOf(flow())
    h = apply(h, moveNode(h.present, 'post', [1, 1]))
    h = apply(h, moveNode(h.present, 'post', [2, 2]))
    expect(node(h.present, 'post')?.position).toEqual([2, 2])

    h = undo(h)
    expect(node(h.present, 'post')?.position).toEqual([1, 1])
    h = undo(h)
    expect(node(h.present, 'post')?.position).toEqual([250, 0])

    h = redo(h)
    expect(node(h.present, 'post')?.position).toEqual([1, 1])
  })

  it('stops at the beginning and the end rather than throwing', () => {
    const h = historyOf(flow())
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('abandons the redo branch once a new edit lands', () => {
    // Keeping it would offer a future that no longer follows from the present.
    let h = historyOf(flow())
    h = apply(h, moveNode(h.present, 'post', [1, 1]))
    h = undo(h)
    h = apply(h, moveNode(h.present, 'post', [9, 9]))
    expect(h.future).toHaveLength(0)
    expect(redo(h)).toBe(h)
  })

  it('ignores an edit that changed nothing', () => {
    // The refusals above return the same object, and a no-op must not become an
    // undo step someone has to press through.
    const h = historyOf(flow())
    expect(apply(h, connect(h.present, 'entry', 'post', 'ok'))).toBe(h)
  })
})
