import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

async function mount(core: unknown[] = []) {
  vi.resetModules()
  const calls: string[] = []
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string) => {
      calls.push(method)
      if (method === 'list_diagnostics') return core as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)

  const { ErrorLogView } = await import('./ErrorLogView')
  const store = await import('@/stores/diagnostics')
  render(<ErrorLogView />)
  return { calls, ...store }
}

/**
 * The entry that prompted all of this: `octaweave_status` degrades a pod that
 * will not answer into an empty integration list, and the settings card renders
 * that as "the pack is not installed".
 */
const swallowed = {
  id: 7,
  at: Date.parse('2026-08-24T10:00:00Z'),
  level: 'warn',
  source: 'octaweave_status',
  message:
    "the pod would not list its integrations, so Octaweave shows as 'not installed' whether or not the pack is actually there",
  detail: 'error decoding response body',
  count: 3,
}

describe('ErrorLogView', () => {
  it('says nothing is wrong in a way that also says the log works', async () => {
    // "No entries" alone leaves someone wondering whether it is empty or broken.
    await mount()
    await waitFor(() => expect(screen.getByText('Nothing has gone wrong this session.')).toBeTruthy())
    expect(screen.getByText(/Failed commands land here on their own/)).toBeTruthy()
  })

  it('shows what the core worked around instead of reporting', async () => {
    await mount([swallowed])
    await waitFor(() => expect(screen.getByText(/would not list its integrations/)).toBeTruthy())
    // Where to look in the source, and who recorded it.
    expect(screen.getByText('octaweave_status')).toBeTruthy()
    expect(screen.getByText('core')).toBeTruthy()
  })

  it('leads with the consequence and folds the exception away', async () => {
    await mount([swallowed])
    await waitFor(() => expect(screen.getByText(/would not list its integrations/)).toBeTruthy())

    // The exception is present but not competing with the sentence for attention.
    const detail = screen.getByText('error decoding response body')
    expect(detail.closest('details')?.hasAttribute('open')).toBe(false)
    // The summary itself, not the label span inside it: happy-dom activates
    // <details> on the summary rather than on a descendant the way a browser does.
    await userEvent.click(screen.getByText('Show detail').closest('summary')!)
    expect(detail.closest('details')?.hasAttribute('open')).toBe(true)
  })

  it('says how many times rather than repeating the line', async () => {
    await mount([swallowed])
    await waitFor(() => expect(screen.getByText('×3')).toBeTruthy())
    expect(screen.getAllByText(/would not list its integrations/).length).toBe(1)
  })

  it('stays quiet about a count of one', async () => {
    await mount([{ ...swallowed, count: 1 }])
    await waitFor(() => expect(screen.getByText(/would not list its integrations/)).toBeTruthy())
    expect(screen.queryByText('×1')).toBeNull()
  })

  it('separates a failure from a degradation in the summary', async () => {
    await mount([swallowed, { ...swallowed, id: 8, level: 'error', message: 'the pod would not answer' }])
    await waitFor(() => expect(screen.getByText(/2 entries/)).toBeTruthy())
    expect(screen.getByText(/1 failed outright/)).toBeTruthy()
  })

  it('marks the log read when it is opened, so the badge means something', async () => {
    const { useDiagnostics, unseen } = await mount([swallowed])
    await waitFor(() => expect(unseen(useDiagnostics.getState()).count).toBe(0))
  })

  it('empties both halves when cleared', async () => {
    const { calls } = await mount([swallowed])
    await waitFor(() => expect(screen.getByText(/would not list its integrations/)).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: /Clear/ }))
    await waitFor(() => expect(screen.getByText('Nothing has gone wrong this session.')).toBeTruthy())
    // The core keeps its own buffer, so clearing has to reach across.
    expect(calls).toContain('clear_diagnostics')
  })
})
