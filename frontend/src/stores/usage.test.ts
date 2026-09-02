import { describe, expect, it } from 'vitest'
import { fillOf, percentLabel, thresholdOf } from './usage'
import type { ChatContext } from '@/types'

const context = (patch: Partial<ChatContext> = {}): ChatContext => ({
  estimated_tokens: 40_000,
  message_count: 12,
  context_window: 128_000,
  compact_threshold_tokens: 76_800,
  would_compact: false,
  ...patch,
})

describe('how full the context is', () => {
  it('is a fraction of the window', () => {
    expect(fillOf(context())).toBeCloseTo(0.3125)
    expect(thresholdOf(context())).toBeCloseTo(0.6)
  })

  it('says nothing when there is nothing to say', () => {
    // Not zero. A pod that cannot answer and a conversation that is empty are
    // different facts, and a 0% ring asserts the second.
    expect(fillOf(undefined)).toBe(null)
    expect(thresholdOf(undefined)).toBe(null)
  })

  it('refuses to divide by a window of zero', () => {
    // A pod reporting no window would otherwise make this Infinity, and paint a
    // full ring on an empty conversation.
    expect(fillOf(context({ context_window: 0 }))).toBe(null)
    expect(thresholdOf(context({ context_window: 0 }))).toBe(null)
  })

  it('has no threshold to mark when the pod reports none', () => {
    expect(thresholdOf(context({ compact_threshold_tokens: 0 }))).toBe(null)
  })

  it('clamps a context that has overrun its window', () => {
    // Real: the estimate is approximate, so it can exceed the window before
    // compaction catches up. A bar past 100% reads as a bug.
    expect(fillOf(context({ estimated_tokens: 200_000 }))).toBe(1)
  })
})

describe('the percentage label', () => {
  it('never rounds up to 100% while there is room left', () => {
    // 0.996 is not full. Saying "100%" there is the readout claiming the
    // conversation has stopped when it has not.
    expect(percentLabel(0.996)).toBe('99%')
    expect(percentLabel(1)).toBe('100%')
  })

  it('has a floor that is not 0%', () => {
    // The reference's own `<1%`: a started conversation is not an empty one.
    expect(percentLabel(0.004)).toBe('<1%')
    expect(percentLabel(0)).toBe('0%')
  })

  it('reads whole percents in between', () => {
    expect(percentLabel(0.3125)).toBe('31%')
    expect(percentLabel(0.5)).toBe('50%')
  })
})
