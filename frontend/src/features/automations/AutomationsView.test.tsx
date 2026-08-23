import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

/** An armed daily brief, plus one schedule nobody has armed. */
const BRIEF = {
  id: 'brief',
  name: 'Morning brief',
  enabled: true,
  node_count: 3,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
  v2: true,
  preset: 'amy-kitchen',
  armed: true,
  schedules: [
    {
      id: 'morning',
      name: 'Every morning',
      type: 'cron',
      cron: '0 0 8 * * *',
      enabled: true,
      instance_id: 'inst_amy',
      instance_name: 'Amy — Morning brief',
      description: 'Cron `0 0 8 * * *` (local time)',
      next_fire_at: '2026-08-24T08:00:00-04:00',
    },
    {
      id: 'evening',
      name: 'Evening recap',
      type: 'cron',
      cron: '0 0 18 * * *',
      enabled: true,
      description: 'Cron `0 0 18 * * *` (local time)',
    },
  ],
}

/** Shipped by a pack and never turned on — the majority case. */
const DORMANT = {
  id: 'prep',
  name: 'Sunday prep',
  enabled: false,
  node_count: 5,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  v2: true,
  preset: 'general-agent',
  armed: false,
  schedules: [
    {
      id: 'weekly',
      name: 'Weekly',
      type: 'cron',
      cron: '0 8 * * *',
      enabled: true,
      description: 'Invalid cron `0 8 * * *`: expected 6 fields',
    },
  ],
}

const PAUSED_RUN = {
  id: 'run_1',
  flow_id: 'brief',
  status: 'paused',
  current_node_id: 'approve',
  instance_id: 'inst_amy',
  pause: { reason: 'approval', resume_handles: ['approve', 'reject'], message: 'Order 3 items?' },
  warnings: [],
  created_at: '2026-08-20T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
}

async function mount(over: Record<string, unknown> = {}) {
  vi.resetModules()
  const calls: { method: string; args?: Record<string, unknown> }[] = []
  const responses: Record<string, unknown> = {
    list_flows: [BRIEF, DORMANT],
    list_flow_runs: [PAUSED_RUN],
    arm_schedule: { id: 'inst_new', name: 'Amy — Evening recap' },
    disarm_schedule: null,
    list_instances: [],
    list_presets: [],
    ...over,
  }
  const transport: Transport = {
    call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args })
      if (!(method in responses)) throw new Error(`unstubbed: ${method}`)
      const value = responses[method]
      if (value instanceof Error) throw value
      return value as never
    }),
    listen: vi.fn(async () => () => {}),
  }
  const t = await import('@/rpc/transport')
  t.setTransport(transport)
  const { AutomationsView } = await import('./AutomationsView')
  render(<AutomationsView />)
  return { calls }
}

describe('AutomationsView', () => {
  it('lists disabled automations, not just the armed ones', async () => {
    // The case that matters: a pack ships its flows off, so a view that showed
    // only what is running would show nothing on a freshly-installed pod.
    await mount()
    await waitFor(() => expect(screen.getByText('Morning brief')).toBeTruthy())
    expect(screen.getByText('Sunday prep')).toBeTruthy()
    expect(screen.getByText('off')).toBeTruthy()
  })

  it('names the agent an armed schedule runs as, and says so when there is none', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('Amy — Morning brief')).toBeTruthy())
    // Two schedules on one flow: one armed, one not. The unarmed one must not
    // borrow the other's agent.
    expect(screen.getAllByText('not armed').length).toBe(2)
  })

  it('shows a schedule that cannot fire as broken rather than blank', async () => {
    // The pod's own words, verbatim — a five-field cron is rejected by its
    // parser, and "Invalid cron" is the only signal a user will ever get.
    await mount()
    await waitFor(() =>
      expect(screen.getByText(/Invalid cron `0 8 \* \* \*`/)).toBeTruthy(),
    )
  })

  it('puts a run waiting on a human above everything else', async () => {
    await mount()
    await waitFor(() => expect(screen.getByText('Waiting on you')).toBeTruthy())
    expect(screen.getByText('Order 3 items?')).toBeTruthy()
  })

  it('arms a schedule and re-reads the pod rather than guessing the result', async () => {
    // Arming can mint an agent or attach to an existing one, and it flips the
    // flow's `armed`; the store re-loads instead of patching state locally.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getAllByText('Arm').length).toBe(2))
    await userEvent.click(screen.getAllByText('Arm')[0])
    await waitFor(() => expect(calls.some((c) => c.method === 'arm_schedule')).toBe(true))
    const armed = calls.find((c) => c.method === 'arm_schedule')
    expect(armed?.args).toMatchObject({ flowId: 'brief', scheduleId: 'evening' })
    expect(calls.filter((c) => c.method === 'list_flows').length).toBeGreaterThan(1)
  })

  it('says what to do when the pod has no automations at all', async () => {
    await mount({ list_flows: [], list_flow_runs: [] })
    await waitFor(() => expect(screen.getByText('No automations on this pod')).toBeTruthy())
  })
})
