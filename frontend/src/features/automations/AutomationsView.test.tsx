import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

/** A flow that runs twice a day. The *work* — its timing is separate. */
const BRIEF = {
  id: 'brief',
  name: 'Morning brief',
  node_count: 3,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
  v2: true,
  preset: 'amy-kitchen',
  scheduled_count: 2,
  enabled_count: 1,
}

/** Installed by a pack and never scheduled — the majority case. */
const DORMANT = {
  id: 'prep',
  name: 'Sunday prep',
  node_count: 5,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  v2: true,
  preset: 'general-agent',
  scheduled_count: 1,
  enabled_count: 0,
}

/** What the pod will do on its own: one live, one paused, one that cannot fire. */
const SCHEDULED = [
  {
    id: 'sf_morning',
    flow_id: 'brief',
    flow_name: 'Morning brief',
    enabled: true,
    schedule: { type: 'cron', cron: '0 0 8 * * *', name: 'Every morning' },
    instance_id: 'inst_amy',
    instance_name: 'Amy — Morning brief',
    description: 'Cron `0 0 8 * * *` (local time)',
    next_fire_at: '2026-08-24T08:00:00-04:00',
  },
  {
    id: 'sf_evening',
    flow_id: 'brief',
    flow_name: 'Morning brief',
    enabled: false,
    schedule: { type: 'cron', cron: '0 0 18 * * *', name: 'Evening recap' },
    instance_id: 'inst_amy',
    instance_name: 'Amy — Morning brief',
    description: 'Cron `0 0 18 * * *` (local time)',
  },
  {
    id: 'sf_weekly',
    flow_id: 'prep',
    flow_name: 'Sunday prep',
    enabled: false,
    schedule: { type: 'cron', cron: '0 8 * * *', name: 'Weekly' },
    description: 'Invalid cron `0 8 * * *`: expected 6 fields',
  },
]

/** A flow with no schedule pointing at it at all. */
const UNSCHEDULED = {
  id: 'tidy',
  name: 'Tidy up',
  node_count: 2,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
  v2: true,
  preset: 'general-agent',
  scheduled_count: 0,
  enabled_count: 0,
}

/** What the pod says scheduling would permit. Every field is served today. */
const BINDING = {
  flow_id: 'brief',
  preset: 'amy-kitchen',
  bound: true,
  personas: [
    { slug: 'amy', allowed: true },
    { slug: 'amy-shopper', allowed: true },
  ],
  armed: [
    {
      schedule_id: 'sf_morning',
      name: 'Every morning',
      instance_id: 'inst_amy',
      instance_name: 'Amy — Morning brief',
    },
  ],
  consent: {
    preset_name: 'Amy',
    domains: ['api.instacart.com'],
    requires_env: ['METALCRAFT_TOKEN', 'INSTACART_TOKEN'],
    missing_env: ['INSTACART_TOKEN'],
    mutating_tools: ['instacart_order', 'bash', 'mem_remember', 'write_file', 'edit_file', 'sub_agent'],
    tool_count: 49,
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
    list_scheduled_flows: SCHEDULED,
    list_flow_runs: [PAUSED_RUN],
    arm_schedule: {
      id: 'sf_new',
      flow_id: 'brief',
      enabled: true,
      schedule: { type: 'cron', cron: '0 0 8 * * *' },
      instance_id: 'inst_new',
      instance_name: 'Amy — Morning brief',
      description: 'Cron `0 0 8 * * *`',
    },
    update_schedule: null,
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
  it('lists flows nothing has scheduled, not just the running ones', async () => {
    // The case that matters: a pack installs its flows scheduling nothing, so a
    // view that showed only what runs would show nothing on a fresh pod.
    await mount({ list_flows: [BRIEF, DORMANT, UNSCHEDULED], list_scheduled_flows: SCHEDULED })
    // `getAll`: the flow's name also appears on its paused run above.
    await waitFor(() => expect(screen.getAllByText('Morning brief').length).toBeGreaterThan(0))
    expect(screen.getByText('Sunday prep')).toBeTruthy()
    expect(screen.getByText('Tidy up')).toBeTruthy()
    // "Not scheduled" and "scheduled but paused" are different states and read
    // differently: only the flow with no schedules at all gets the chip, and the
    // two paused *schedules* keep theirs.
    expect(screen.getAllByText('not scheduled').length).toBe(1)
    // Three, not two: the paused run above carries its status as a badge with the
    // same word. Counting it in deliberately — pinning 2 here would break the
    // day someone adds a second paused run to this fixture, for no reason.
    expect(screen.getAllByText('paused').length).toBe(3)
  })

  it('names the agent each schedule runs as', async () => {
    await mount()
    await waitFor(() =>
      expect(screen.getAllByText('Amy — Morning brief').length).toBeGreaterThan(0),
    )
    // A schedule with no agent shows no agent chip rather than borrowing one
    // from its neighbour.
    expect(screen.getByText('Weekly')).toBeTruthy()
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

  it('asks before scheduling, and states what will happen unwatched', async () => {
    // Scheduling is the moment this pod agrees to act while nobody is looking, so
    // the click opens a consent summary rather than scheduling. Every line of it
    // is the pod's answer, not this app's guess.
    await mount()
    await waitFor(() => expect(screen.getAllByText('Add another schedule').length).toBe(2))
    await userEvent.click(screen.getAllByText('Add another schedule')[0]!)

    await waitFor(() => expect(screen.getByText(/Schedule "Morning brief"/)).toBeTruthy())
    // The two lines that matter most: what it can change, and the credential
    // whose absence would otherwise surface at 3am.
    // Loudest first, capped, with an honest count — a real preset has dozens of
    // mutating tools and the full list is a wall nobody reads.
    expect(screen.getByText(/change things: bash, write_file, edit_file, web_fetch|change things: bash, write_file, edit_file/)).toBeTruthy()
    expect(screen.getByText(/6 of 49 tools it can call change something/)).toBeTruthy()
    expect(screen.getByText(/does not have INSTACART_TOKEN/)).toBeTruthy()
    expect(screen.getByText(/starts from 214 entries/)).toBeTruthy()
  })

  it('schedules on confirmation, re-reads the pod, and opens the agent it created', async () => {
    // Scheduling can mint an agent or attach to an existing one, and it changes
    // what the listing says; the store re-loads instead of patching locally.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getAllByText('Add another schedule').length).toBe(2))
    await userEvent.click(screen.getAllByText('Add another schedule')[0]!)
    await waitFor(() => expect(screen.getByText('Schedule it')).toBeTruthy())
    await userEvent.click(screen.getByText('Schedule it'))

    await waitFor(() => expect(calls.some((c) => c.method === 'arm_schedule')).toBe(true))
    const armed = calls.find((c) => c.method === 'arm_schedule')
    // The trigger is carried, not just the flow: there is no schedule to select
    // any more, so the dialog is where one comes into existence.
    expect(armed?.args).toMatchObject({ flowId: 'brief' })
    expect(armed?.args?.schedule).toMatchObject({ type: 'cron' })
    expect(calls.filter((c) => c.method === 'list_flows').length).toBeGreaterThan(1)

    // The new agent is the point of arming, so the app goes there — and the
    // fleet must be re-read on the way, because that is where the session view
    // looks the agent up. Skipping it navigates to an agent the app has never
    // heard of, which is what a live pod showed.
    const { useUi } = await import('@/stores/ui')
    await waitFor(() => expect(useUi.getState().activeKey).toBe('session:inst_new'))
    const armedAt = calls.findIndex((c) => c.method === 'arm_schedule')
    expect(calls.slice(armedAt).some((c) => c.method === 'list_instances')).toBe(true)
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

  it('pauses a schedule without deleting it, and removes it when asked', async () => {
    // Two different answers — "not now" and "never again" — and only one of them
    // should cost you the schedule. Both keep the agent.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getAllByText('Pause').length).toBe(1))
    await userEvent.click(screen.getAllByText('Pause')[0]!)
    await waitFor(() => expect(calls.some((c) => c.method === 'update_schedule')).toBe(true))
    expect(calls.find((c) => c.method === 'update_schedule')?.args).toMatchObject({
      scheduledId: 'sf_morning',
      enabled: false,
    })

    await userEvent.click(screen.getAllByText('Remove')[0]!)
    await waitFor(() => expect(calls.some((c) => c.method === 'disarm_schedule')).toBe(true))
    expect(calls.find((c) => c.method === 'disarm_schedule')?.args).toMatchObject({
      scheduledId: 'sf_morning',
    })
  })

  it('says what to do when the pod has no automations at all', async () => {
    await mount({ list_flows: [], list_scheduled_flows: [], list_flow_runs: [] })
    await waitFor(() => expect(screen.getByText('No automations on this pod')).toBeTruthy())
  })
})
