import type { ToolCard, TranscriptItem } from './transcript'

/**
 * Group a flat transcript into render blocks, collapsing **consecutive** tool
 * calls into one trace.
 *
 * Grouping happens here rather than in the reducer on purpose: the reducer
 * mirrors what the pod actually sent, one frame to one item, which is what makes
 * it testable against recorded streams. How those items are packed for reading is
 * a view decision, and it changes when the design does.
 */
export type Block =
  | { kind: 'tools'; id: string; cards: ToolCard[] }
  | { kind: 'item'; item: Exclude<TranscriptItem, ToolCard> }

export function groupIntoBlocks(items: TranscriptItem[]): Block[] {
  const blocks: Block[] = []
  for (const item of items) {
    if (item.kind === 'tool') {
      const last = blocks.at(-1)
      if (last?.kind === 'tools') {
        last.cards.push(item)
        continue
      }
      blocks.push({ kind: 'tools', id: `tools-${item.id}`, cards: [item] })
      continue
    }
    blocks.push({ kind: 'item', item })
  }
  return blocks
}
