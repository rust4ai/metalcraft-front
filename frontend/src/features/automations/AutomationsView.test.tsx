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

/** What the pod says arming would permit. Every field is served today. */
const BINDING = {
  flow_id: 'brief',
  preset: 'amy-kitchen',
  bound: true,
  personas: [
    { slug: 'amy', allowed: true },
    { slug: 'amy-shopper', allowed: true },
  ],
  armed: [{ schedule_id: 'morning', instance_id: 'inst_amy', instance_name: 'Amy — Morning brief' }],
  consent: {
    preset_name: 'Amy',
    domains: ['api.instacart.com'],
    requires_env: ['METALCRAFT_TOKEN', 'INSTACART_TOKEN'],
    missing_env: ['INSTACART_TOKEN'],
    mutating_tools: ['instacart_order'],
    tool_count: 7,
    base_memories: 214,
  },
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
    flow_binding: BINDING,
    run_flow: { run_id: 'run_2', flow_id: 'brief', status: 'completed', chat_id: 'chat_1', warnings: [] },
    resume_flow_run: { run_id: 'run_1', flow_id: 'brief', status: 'completed', chat_id: 'chat_1', warnings: [] },
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
    // `getAll`: the armed flow's name also appears on its paused run above.
    await waitFor(() => expect(screen.getAllByText('Morning brief').length).toBeGreaterThan(0))
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
    // Regex: the approval prompt shares its line with the run's age.
    expect(screen.getByText(/Order 3 items\?/)).toBeTruthy()
  })

  it('asks before arming, and states what will happen unwatched', async () => {
    // Arming is the moment this pod agrees to act while nobody is looking, so
    // the click opens a consent summary rather than arming. Every line of it is
    // the pod's answer, not this app's guess.
    await mount()
    await waitFor(() => expect(screen.getAllByText('Arm').length).toBe(2))
    await userEvent.click(screen.getAllByText('Arm')[0]!)

    await waitFor(() => expect(screen.getByText(/Arm "Evening recap"/)).toBeTruthy())
    // The two lines that matter most: what it can change, and the credential
    // whose absence would otherwise surface at 3am.
    expect(screen.getByText(/change things: instacart_order/)).toBeTruthy()
    expect(screen.getByText(/does not have INSTACART_TOKEN/)).toBeTruthy()
    expect(screen.getByText(/starts from 214 entries/)).toBeTruthy()
  })

  it('arms on confirmation, re-reads the pod, and opens the agent it created', async () => {
    // Arming can mint an agent or attach to an existing one, and it flips the
    // flow's `armed`; the store re-loads instead of patching state locally.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getAllByText('Arm').length).toBe(2))
    await userEvent.click(screen.getAllByText('Arm')[0]!)
    await waitFor(() => expect(screen.getByText('Arm it')).toBeTruthy())
    await userEvent.click(screen.getByText('Arm it'))

    await waitFor(() => expect(calls.some((c) => c.method === 'arm_schedule')).toBe(true))
    const armed = calls.find((c) => c.method === 'arm_schedule')
    expect(armed?.args).toMatchObject({ flowId: 'brief', scheduleId: 'evening' })
    expect(calls.filter((c) => c.method === 'list_flows').length).toBeGreaterThan(1)

    // The new agent is the point of arming, so the app goes there.
    const { useUi } = await import('@/stores/ui')
    await waitFor(() => expect(useUi.getState().activeKey).toBe('session:inst_new'))
  })

  it('lands you in the conversation a hand-run just wrote', async () => {
    // Running an armed automation by hand is its scheduled firing: the reward is
    // a transcript, so the button ends in the agent rather than in a status code.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getAllByText('Run now').length).toBe(2))
    await userEvent.click(screen.getAllByText('Run now')[0]!)
    await waitFor(() => expect(calls.some((c) => c.method === 'run_flow')).toBe(true))
    expect(calls.find((c) => c.method === 'run_flow')?.args).toMatchObject({ flowId: 'brief' })

    const { useUi } = await import('@/stores/ui')
    await waitFor(() => expect(useUi.getState().activeKey).toBe('session:inst_amy'))
  })

  it('takes the decision a paused run is waiting on', async () => {
    // The whole point of surfacing paused runs: answering one here is what
    // closes the loop, and the run continues in the thread it paused in.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByText('approve')).toBeTruthy())
    expect(screen.getByText('reject')).toBeTruthy()
    await userEvent.click(screen.getByText('approve'))
    await waitFor(() => expect(calls.some((c) => c.method === 'resume_flow_run')).toBe(true))
    expect(calls.find((c) => c.method === 'resume_flow_run')?.args).toMatchObject({
      runId: 'run_1',
      handle: 'approve',
    })
  })

  it('offers no decision on a run that is only waiting for the clock', async () => {
    // A `wait` resumes on time. A button for its "after" handle would let
    // someone skip the wait the flow asked for.
    await mount({
      list_flow_runs: [
        {
          ...PAUSED_RUN,
          pause: { reason: 'wait', resume_handles: ['after'], wake_at: '2026-08-30T00:00:00Z' },
        },
      ],
    })
    await waitFor(() => expect(screen.getByText('Waiting on you')).toBeTruthy())
    expect(screen.queryByText('after')).toBeNull()
  })

  it('says what to do when the pod has no automations at all', async () => {
    await mount({ list_flows: [], list_flow_runs: [] })
    await waitFor(() => expect(screen.getByText('No automations on this pod')).toBeTruthy())
  })
})
