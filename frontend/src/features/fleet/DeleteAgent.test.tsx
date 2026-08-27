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
  const { DeleteAgent } = await import('./DeleteAgent')
  const { useFleet } = await import('@/stores/fleet')
  const { useUi } = await import('@/stores/ui')
  useFleet.setState({ instances: [instance] })
  useUi.getState().go({ kind: 'session', instanceId: 'i1' })
  render(<DeleteAgent instance={instance} />)
  return { call, useFleet, useUi }
}

const ask = () => userEvent.click(screen.getByRole('button', { name: 'Delete agent' }))
const confirm = () => userEvent.click(screen.getByRole('button', { name: 'Delete' }))

describe('DeleteAgent', () => {
  it('asks before it deletes — the trigger alone touches nothing', async () => {
    const { call } = await mount({ list_scheduled_flows: [] })
    await ask()
    expect(screen.getByRole('dialog', { name: 'Delete Amy' })).toBeTruthy()
    expect(call).not.toHaveBeenCalledWith('delete_instance', expect.anything())
  })

  it('deletes on confirm, and takes the agent out of the fleet', async () => {
    const { call, useFleet } = await mount({ list_scheduled_flows: [], delete_instance: null })
    await ask()
    await confirm()
    await waitFor(() => expect(call).toHaveBeenCalledWith('delete_instance', { id: 'i1' }))
    await waitFor(() => expect(useFleet.getState().instances).toHaveLength(0))
  })

  it('closes the deleted agent’s tab, so nothing is left open on a 404', async () => {
    const { useUi } = await mount({ list_scheduled_flows: [], delete_instance: null })
    expect(useUi.getState().tabs.some((t) => t.key === 'session:i1')).toBe(true)
    await ask()
    await confirm()
    await waitFor(() => expect(useUi.getState().tabs.some((t) => t.key === 'session:i1')).toBe(false))
  })

  it('keeps the confirm open and shows why when the pod refuses', async () => {
    // A delete that failed and closed looks exactly like one that worked.
    const { useFleet } = await mount({
      list_scheduled_flows: [],
      delete_instance: new Error('pod said no'),
    })
    await ask()
    await confirm()
    await waitFor(() => expect(screen.getByText(/pod said no/)).toBeTruthy())
    expect(screen.getByRole('dialog', { name: 'Delete Amy' })).toBeTruthy()
    expect(useFleet.getState().instances).toHaveLength(1)
  })

  it('warns about the schedules that run as this agent', async () => {
    await mount({
      list_scheduled_flows: [
        { id: 'sf_1', flow_id: 'f', instance_id: 'i1', enabled: true, schedule: {}, description: '' },
        { id: 'sf_2', flow_id: 'f', instance_id: 'other', enabled: true, schedule: {}, description: '' },
      ],
    })
    await ask()
    await waitFor(() => expect(screen.getByText(/1 scheduled flow runs/)).toBeTruthy())
  })

  it('says nothing about schedules when the pod cannot be asked', async () => {
    // An old pod has no scheduled flows endpoint. Silence, not "nothing points
    // at it" — which would be a claim we never got an answer for.
    await mount({ list_scheduled_flows: new Error('404 not found'), delete_instance: null })
    await ask()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Delete Amy' })).toBeTruthy())
    expect(screen.queryByText(/scheduled flow/)).toBeNull()
  })

  it('cancels on Escape without touching the pod', async () => {
    const { call } = await mount({ list_scheduled_flows: [] })
    await ask()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(call).not.toHaveBeenCalledWith('delete_instance', expect.anything())
  })
})
