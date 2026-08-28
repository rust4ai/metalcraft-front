import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const env = [
  { name: 'OPENAI_API_KEY', needed_by: ['chef'], required: true },
  { name: 'SPOON_API_KEY', needed_by: ['recipe'], required: true },
  { name: 'NICE_TO_HAVE', needed_by: ['chef'], required: false },
]

async function mount(
  responses: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
) {
  vi.resetModules()
  const calls: { method: string; args: unknown }[] = []
  const t = await import('@/rpc/transport')
  t.setTransport({
    call: vi.fn(async (method: string, args: unknown) => {
      calls.push({ method, args })
      if (method in responses) {
        const r = responses[method]
        if (r instanceof Error) throw r
        return r as never
      }
      if (method === 'list_keys') return [] as never
      if (method === 'recommended_keys') return [] as never
      return undefined as never
    }),
    listen: vi.fn(async () => () => {}),
  } as Transport)
  const { KeyNeeds } = await import('./KeyNeeds')
  render(<KeyNeeds env={env} subject="this pack" {...props} />)
  return calls
}

describe('KeyNeeds', () => {
  it('counts only the required keys the pod is missing', async () => {
    await mount({
      list_keys: [{ name: 'OPENAI_API_KEY', masked: 'sk-…', scope: 'global', managed: false }],
    })
    await waitFor(() =>
      expect(screen.getByText(/One key this pack needs is not in this pod/)).toBeTruthy(),
    )
    // An optional key is listed and never counted: a pack that works better with
    // a key it does not require must not look broken for lacking one.
    expect(screen.getByText('optional')).toBeTruthy()
  })

  it('writes a value from the page that reported it missing', async () => {
    const calls = await mount()
    await waitFor(() => expect(screen.getByText('SPOON_API_KEY')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Set SPOON_API_KEY' }))
    await userEvent.type(screen.getByLabelText('Value for SPOON_API_KEY'), 'spn_live_x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const save = calls.find((c) => c.method === 'save_key')
    expect(save?.args).toEqual({ name: 'SPOON_API_KEY', value: 'spn_live_x' })
    // Re-read afterwards, or the row that was just satisfied keeps saying missing.
    expect(calls.filter((c) => c.method === 'list_keys').length).toBeGreaterThan(1)
  })

  it('tells the page holding its own key list to re-read', async () => {
    const onSaved = vi.fn()
    await mount({}, { onSaved })
    await userEvent.click(screen.getByRole('button', { name: 'Set SPOON_API_KEY' }))
    await userEvent.type(screen.getByLabelText('Value for SPOON_API_KEY'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('keeps the field open and says why when the pod refuses the write', async () => {
    await mount({ save_key: new Error('pod said no') })
    await userEvent.click(screen.getByRole('button', { name: 'Set SPOON_API_KEY' }))
    await userEvent.type(screen.getByLabelText('Value for SPOON_API_KEY'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText(/pod said no/)).toBeTruthy())
    expect(screen.getByLabelText('Value for SPOON_API_KEY')).toBeTruthy()
  })

  it('offers no field for a key the platform provides', async () => {
    // Prompting for a value nobody can supply is worse than saying nothing.
    await mount({
      recommended_keys: [
        { name: 'SPOON_API_KEY', packs: ['amy_kitchen'], configured: true, managed: true },
      ],
    })
    await waitFor(() => expect(screen.getByText('provided')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /SPOON_API_KEY/ })).toBeNull()
  })

  it('counts a key the pod reports configured as met, unstored or not', async () => {
    // `recommended_keys` knows about credentials the key store does not list.
    await mount({
      recommended_keys: [
        { name: 'OPENAI_API_KEY', packs: ['amy_kitchen'], configured: true, managed: false },
        { name: 'SPOON_API_KEY', packs: ['amy_kitchen'], configured: true, managed: false },
      ],
    })
    await waitFor(() => expect(screen.getByText('SPOON_API_KEY')).toBeTruthy())
    expect(screen.queryByText(/not in this pod/)).toBeNull()
    // Met, but still replaceable — a rotated credential is set from here too.
    expect(screen.getByRole('button', { name: 'Replace SPOON_API_KEY' })).toBeTruthy()
  })
})
