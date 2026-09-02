import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Trace, looksFailed } from './Trace'
import type { ToolCard } from './transcript'

afterEach(cleanup)

/** The call that found this: a delegated sub-agent whose args are one long line. */
const WIDE: ToolCard = {
  kind: 'tool',
  id: 'a',
  name: 'sub_agent',
  args: {
    pack: 'buildr-space',
    task: 'Create a new buildr.space workspace, then clone https://github.com/ethereumdegen/octaweave into it and verify the checkout',
  },
  status: 'done',
  durationMs: 47_482,
  result: '{"error":true,"result":"Sub-agent failed at agent: 402 insufficient_credits"}',
}

describe('Trace', () => {
  it('settles into a past-tense summary and opens on click', () => {
    render(<Trace cards={[WIDE]} />)
    const toggle = screen.getByRole('button', { name: /Ran 1 tool/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('args')).toBeTruthy()
  })

  /**
   * jsdom has no layout, so the invariant has to be asserted on the classes: a
   * *column* flex container may not also wrap, because a wrapped line sizes its
   * cross-axis to its contents and drags the whole transcript sideways.
   */
  it('shows what is running, and stops once it has run', () => {
    // Mid-turn the chips answer "what is it doing right now", which the count
    // cannot. Settled, "Ran 1 tool" says everything they did and the detail is
    // one click away — so the reading flow gets its line back.
    const { rerender } = render(<Trace cards={[{ ...WIDE, status: 'running' }]} />)
    expect(screen.getByRole('list')).toBeTruthy()

    rerender(<Trace cards={[WIDE]} />)
    expect(screen.queryByRole('list')).toBe(null)
    expect(screen.getByRole('button', { name: /Ran 1 tool/ })).toBeTruthy()
  })

  it('does not wrap the expanded column, so a wide payload cannot widen the chat', () => {
    // The collapsed running row wraps; the expanded column must not. A wrapped
    // *column* sizes each line's cross-axis — the width — to its contents, so
    // one long JSON line drags the whole transcript sideways.
    render(<Trace cards={[{ ...WIDE, status: 'running' }]} />)
    const collapsed = screen.getByRole('list')
    expect(collapsed.className).toContain('flex-wrap')
    expect(collapsed.className).not.toContain('flex-col')

    cleanup()
    render(<Trace cards={[WIDE]} />)
    fireEvent.click(screen.getByRole('button', { name: /Ran 1 tool/ }))
    const expanded = screen.getByRole('list')
    expect(expanded.className).toContain('flex-col')
    expect(expanded.className).not.toContain('flex-wrap')
  })

  it('keeps horizontal scrolling inside the payload box', () => {
    render(<Trace cards={[WIDE]} />)
    fireEvent.click(screen.getByRole('button', { name: /Ran 1 tool/ }))
    for (const pre of document.querySelectorAll('pre')) {
      expect(pre.className).toContain('overflow-auto')
      expect(pre.className).toContain('break-words')
    }
  })
})

describe('looksFailed', () => {
  it('reads a tool error returned as an ordinary result string', () => {
    expect(looksFailed('Error: no such workspace')).toBe(true)
    expect(looksFailed('cloned 1 repository')).toBe(false)
    expect(looksFailed(undefined)).toBe(false)
  })
})
