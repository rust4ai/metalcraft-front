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
  it('does not wrap the expanded column, so a wide payload cannot widen the chat', () => {
    render(<Trace cards={[WIDE]} />)
    const list = screen.getByRole('list')
    expect(list.className).toContain('flex-wrap')
    expect(list.className).not.toContain('flex-col')

    fireEvent.click(screen.getByRole('button', { name: /Ran 1 tool/ }))
    expect(list.className).toContain('flex-col')
    expect(list.className).not.toContain('flex-wrap')
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
