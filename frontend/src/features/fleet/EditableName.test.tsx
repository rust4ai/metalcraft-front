import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentInstance } from '@/types'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

const instance = {
  id: 'i1',
  agent_preset: 'kitchen',
  name: 'Amy',
  persona: 'chef',
  origin: { kind: 'workshop' },
  persistent: false,
  created_at: '',
  last_active_at: '',
} as AgentInstance

async function mount(responses: Record<string, unknown>) {
  vi.resetModules()
  const t = await import('@/rpc/transport')
  const call = vi.fn(async (method: string) => {
    if (!(method in responses)) throw new Error(`unstubbed: ${method}`)
    const r = responses[method]
    if (r instanceof Error) throw r
    return r as never
  })
  t.setTransport({ call, listen: vi.fn(async () => () => {}) } as Transport)
  const { EditableName } = await import('./EditableName')
  render(<EditableName instance={instance} />)
  return call
}

/** Open the field and replace what is in it. */
async function type(name: string) {
  await userEvent.click(screen.getByRole('button', { name: /Amy/ }))
  const field = screen.getByRole('textbox', { name: 'Agent name' })
  await userEvent.clear(field)
  await userEvent.type(field, name)
  return field
}

describe('EditableName', () => {
  it('renames on Enter', async () => {
    const call = await mount({ rename_instance: { ...instance, name: 'Bea', persistent: true } })
    await type('Bea')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(call).toHaveBeenCalledWith('rename_instance', { id: 'i1', name: 'Bea' }))
  })

  it('renames on blur — clicking away is the common path, not a cancel', async () => {
    const call = await mount({ rename_instance: { ...instance, name: 'Bea', persistent: true } })
    await type('Bea')
    await userEvent.tab()
    await waitFor(() => expect(call).toHaveBeenCalledWith('rename_instance', { id: 'i1', name: 'Bea' }))
  })

  it('discards on Escape without touching the pod', async () => {
    const call = await mount({})
    await type('Bea')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: /Amy/ })).toBeTruthy())
    expect(call).not.toHaveBeenCalled()
  })

  it('sends nothing for an empty or unchanged name', async () => {
    // An agent kept under a blank label is one nothing in the fleet can identify.
    const call = await mount({})
    await type(' ')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: /Amy/ })).toBeTruthy())
    expect(call).not.toHaveBeenCalled()
  })

  it('keeps the typed name on the screen when the pod refuses', async () => {
    await mount({ rename_instance: new Error('pod said no') })
    await type('Bea')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByText(/pod said no/)).toBeTruthy())
    expect(screen.getByRole('textbox', { name: 'Agent name' })).toHaveProperty('value', 'Bea')
  })
})
