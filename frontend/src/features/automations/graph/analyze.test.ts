import { describe, expect, it } from 'vitest'
import { unhandledErrorNodes } from './analyze'
import { look, vendorOf } from './nodeKinds'
import type { FlowDefinition } from '@/types'

const def = (
  nodes: Array<[string, string]>,
  edges: Array<[string, string, string?]>,
): FlowDefinition => ({
  nodes: nodes.map(([id, node_type]) => ({ id, node_type, data: {} })),
  edges: edges.map(([source, target, source_handle], i) => ({
    id: `e${i}`,
    source,
    target,
    source_handle,
  })),
})

describe('unhandledErrorNodes', () => {
  it('flags a node that can fail with nothing catching it', () => {
    // The failure this exists for: an unwired `error` rail fails the whole run
    // (SPEC §5.4), and the only evidence in the JSON is an edge that is not there.
    const found = unhandledErrorNodes(
      def(
        [
          ['entry', 'entry'],
          ['call', 'http'],
        ],
        [['entry', 'call']],
      ),
    )
    expect([...found]).toEqual(['call'])
  })

  it('clears a node once its error goes somewhere', () => {
    const found = unhandledErrorNodes(
      def(
        [
          ['entry', 'entry'],
          ['call', 'http'],
          ['recover', 'prompt'],
        ],
        [
          ['entry', 'call'],
          ['call', 'recover', 'error'],
        ],
      ),
    )
    // `recover` is itself a prompt with an unwired error — the point is that
    // `call` is no longer flagged.
    expect(found.has('call')).toBe(false)
  })

  it('does not flag nodes that have no error rail', () => {
    // A `set_variable` cannot fail this way. Flagging it would train people to
    // ignore the flag, which costs more than the flag is worth.
    const found = unhandledErrorNodes(
      def(
        [
          ['entry', 'entry'],
          ['set', 'set_variable'],
          ['done', 'end'],
        ],
        [
          ['entry', 'set'],
          ['set', 'done'],
        ],
      ),
    )
    expect(found.size).toBe(0)
  })

  it('does not flag a vendor node', () => {
    // Its handles are vendor-defined and this build cannot know them; asserting
    // an unhandled failure would be inventing a fact about someone else's node.
    const found = unhandledErrorNodes(
      def(
        [
          ['entry', 'entry'],
          ['post', 'slack:send_message'],
        ],
        [['entry', 'post']],
      ),
    )
    expect(found.size).toBe(0)
  })

  it('reads an ok handle as not being the error rail', () => {
    const found = unhandledErrorNodes(
      def(
        [
          ['entry', 'entry'],
          ['call', 'tool'],
          ['next', 'end'],
        ],
        [
          ['entry', 'call'],
          ['call', 'next', 'ok'],
        ],
      ),
    )
    expect(found.has('call')).toBe(true)
  })
})

describe('look', () => {
  it('names the core types', () => {
    expect(look('prompt').label).toBe('Prompt')
    expect(look('conditional').kind).toBe('routing')
    expect(look('approval').kind).toBe('waiting')
  })

  it('marks the three node types that spend a model call', () => {
    for (const t of ['prompt', 'branch', 'sub_agent']) {
      expect(look(t).thinks, t).toBe(true)
    }
    for (const t of ['tool', 'http', 'set_variable']) {
      expect(look(t).thinks ?? false, t).toBe(false)
    }
  })

  it('draws a vendor type it has never heard of', () => {
    // SPEC §5.2: any `vendor:name` is valid and must round-trip. A viewer that
    // could not draw one would report a working flow as broken.
    const l = look('slack:send_message')
    expect(l.label).toBe('send message')
    expect(l.kind).toBe('unknown')
    expect(vendorOf('slack:send_message')).toBe('slack')
  })

  it('draws a bare type from a newer spec without guessing at it', () => {
    const l = look('teleport')
    expect(l.label).toBe('teleport')
    expect(l.kind).toBe('unknown')
    expect(vendorOf('teleport')).toBeUndefined()
  })

  it('gives an end node no outgoing port', () => {
    expect(look('end').handles).toEqual([])
  })
})

describe('node summaries', () => {
  it('reduces a prompt to one line', () => {
    const s = look('prompt').summary?.({ prompt: 'line one\n\n  line two' })
    expect(s).toBe('line one line two')
  })

  it('says what a set_variable assigns', () => {
    expect(look('set_variable').summary?.({ variable: 'name', from: '_last.name' })).toBe(
      'name = _last.name',
    )
  })

  it('says what an http node calls', () => {
    expect(look('http').summary?.({ method: 'post', url: 'https://x.test/a' })).toBe(
      'POST https://x.test/a',
    )
  })

  it('counts a conditional’s conditions', () => {
    expect(look('conditional').summary?.({ conditions: [{}, {}] })).toBe('2 conditions')
    expect(look('conditional').summary?.({})).toBe('0 conditions')
  })

  it('says nothing rather than something empty', () => {
    expect(look('prompt').summary?.({ prompt: '   ' })).toBeUndefined()
    expect(look('tool').summary?.({})).toBeUndefined()
  })
})
