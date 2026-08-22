import { describe, expect, it } from 'vitest'
import { groupIntoBlocks } from './blocks'
import type { TranscriptItem } from './transcript'

const tool = (id: string): TranscriptItem => ({ kind: 'tool', id, name: 'bash', args: {}, status: 'done' })
const reply = (id: string): TranscriptItem => ({ kind: 'reply', id, content: 'hi' })

describe('groupIntoBlocks', () => {
  it('collapses consecutive tool calls into one trace', () => {
    const blocks = groupIntoBlocks([tool('a'), tool('b'), tool('c')])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'tools' })
    expect(blocks[0]!.kind === 'tools' && blocks[0]!.cards).toHaveLength(3)
  })

  it('starts a new trace after something interrupts the run', () => {
    // Two rounds of work either side of a reply are two traces, not one — the
    // summary line has to describe a contiguous stretch of work to be honest.
    const blocks = groupIntoBlocks([tool('a'), reply('r'), tool('b')])
    expect(blocks.map((b) => b.kind)).toEqual(['tools', 'item', 'tools'])
  })

  it('leaves a transcript with no tools untouched', () => {
    const blocks = groupIntoBlocks([reply('r1'), reply('r2')])
    expect(blocks.map((b) => b.kind)).toEqual(['item', 'item'])
  })

  it('does not mutate the input', () => {
    const items = [tool('a'), tool('b')]
    groupIntoBlocks(items)
    expect(items).toHaveLength(2)
  })
})
