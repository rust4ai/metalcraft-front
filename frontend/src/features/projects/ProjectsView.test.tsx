import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

/** The store is a module singleton and outlives `cleanup`, which unmounts the
 *  DOM and nothing else — so an open project from the previous test would still be
 *  open in the next one, rendering its title twice. Correct behaviour for the
 *  app (switching tabs and back keeps your place); a leak between tests. */
afterEach(async () => {
  const { useProjects } = await import('@/stores/projects')
  useProjects.setState({ projects: [], open: null, journal: [], error: null, busy: {} })
})

/** Stopped, waiting on a person. Its heartbeat is off, so nothing else in the
 *  app will ever raise it again — this is the case the screen is arranged
 *  around. */
const BLOCKED = {
  id: 'proj_billing',
  title: 'Billing',
  goal: 'Ship Stripe billing in rust4ai/foo',
  kind: 'build',
  status: 'blocked',
  blocked_reason: 'Stripe test key or live key?',
  instance_id: 'inst_1',
  progress: { done: 2, total: 5 },
  ticks: 11,
  last_tick_at: '2026-09-03T08:00:00Z',
  every_minutes: 30,
  created_at: '2026-09-01T00:00:00Z',
}

/** Still going, and created more recently — so only the ranking puts the
 *  blocked one above it. */
const WORKING = {
  ...BLOCKED,
  id: 'proj_audit',
  title: 'Audit',
  goal: 'Review rust4ai/bar and open PRs',
  kind: 'audit',
  status: 'active',
  blocked_reason: undefined,
  progress: { done: 1, total: 4 },
  next_tick_at: '2026-09-03T09:00:00Z',
  created_at: '2026-09-02T00:00:00Z',
}

const SCRATCHPAD = `## Project
Ship Stripe billing in rust4ai/foo

## Plan
- [x] 1. Schema + migration
- [ ] 2. Checkout endpoint

## State
Branch \`project/billing\`, migration 0004 applied.

## Blockers
(none)
`

const WITH_TASKS = {
  ...BLOCKED,
  scratchpad: SCRATCHPAD,
  needs_groom: false,
  tasks: [
    {
      id: 't1',
      title: 'Schema and migration',
      status: 'done',
      evidence: [{ kind: 'commit', value: '8f21a0c', at: '' }],
    },
    { id: 't2', title: 'Webhook endpoint', status: 'todo', deps: ['t1'] },
    { id: 't3', title: 'Reconciliation job', status: 'todo', deps: ['t2'] },
    { id: 't4', title: 'Publish', status: 'blocked', blocked_reason: 'needs a token' },
  ],
}

async function mount(over: Record<string, unknown> = {}) {
  const calls: { method: string; args?: Record<string, unknown> }[] = []
  const responses: Record<string, unknown> = {
    list_projects: { projects: [WORKING, BLOCKED], active: 1, max_active: 5 },
    get_project: { ...BLOCKED, scratchpad: SCRATCHPAD, needs_groom: false },
    project_journal: {
      entries: [
        {
          at: '2026-09-03T08:00:00Z',
          tick: 11,
          kind: 'work',
          model: 'gpt-5.4',
          summary: 'Wrote the webhook handler.',
          status: 'active',
          plan_done: 2,
          plan_total: 5,
          progressed: true,
          duration_secs: 42,
        },
        {
          at: '2026-09-03T08:30:00Z',
          tick: 12,
          kind: 'work',
          model: 'gpt-5.4',
          summary: 'Could not decide which key to use.',
          status: 'blocked',
          plan_done: 2,
          plan_total: 5,
          progressed: false,
          duration_secs: 9,
        },
      ],
    },
    update_project: BLOCKED,
    create_project: BLOCKED,
    delete_project: null,
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
  const { ProjectsView } = await import('./ProjectsView')
  render(<ProjectsView />)
  return { calls }
}

describe('ProjectsView', () => {
  it('puts the project that needs a person first, and says what it wants without being opened', async () => {
    // The whole point of the ordering: a blocked project is stalled and silent, and
    // burying it under three that are fine is how it stays that way for a week.
    await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    const titles = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    const blocked = titles.findIndex((t) => t.includes('Billing'))
    const working = titles.findIndex((t) => t.includes('Audit'))
    expect(blocked).toBeLessThan(working)
    // and the question is on the card, not one click away
    expect(screen.getByText('Stripe test key or live key?')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
  })

  it('shows the plan as a checklist when a project is opened', async () => {
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))

    await waitFor(() => expect(screen.getByText('1. Schema + migration')).toBeTruthy())
    expect(screen.getByText('2. Checkout endpoint')).toBeTruthy()
    // The journal is loaded with the project, not after it: a detail screen with a
    // plan and no history is half an answer.
    expect(calls.some((c) => c.method === 'project_journal')).toBe(true)
    expect(screen.getByText('Wrote the webhook handler.')).toBeTruthy()
  })

  it('marks a tick that changed nothing', async () => {
    // A run of these is exactly what the pod's no-progress rail counts, and the
    // difference between working slowly and stuck.
    await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))
    await waitFor(() => expect(screen.getByText('no change')).toBeTruthy())
  })

  it('answers a blocked project in one step, without also asking for a resume', async () => {
    // Replying *is* saying carry on. Making someone answer and then press
    // Resume would be a second step whose omission looks like being ignored.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))
    await waitFor(() => expect(screen.getByLabelText('Answer')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('Answer'), 'Use the test key')
    await userEvent.click(screen.getByText('Answer and carry on'))

    await waitFor(() => {
      const update = calls.find((c) => c.method === 'update_project')
      expect(update).toBeTruthy()
      expect((update?.args?.update as Record<string, unknown>)?.answer).toBe('Use the test key')
      // no status flip alongside it — the pod un-blocks on the answer
      expect((update?.args?.update as Record<string, unknown>)?.status).toBeUndefined()
    })
  })

  it('tells a fresh pod what a project is instead of showing an empty list', async () => {
    await mount({ list_projects: { projects: [], active: 0, max_active: 5 } })
    await waitFor(() => expect(screen.getByText('Nothing on the go.')).toBeTruthy())
  })

  it('explains a pod that is older than this app', async () => {
    // A 404 here reads as a broken pod unless it is named, and the fix — update
    // the pod — is not something an error string suggests on its own.
    await mount({ list_projects: new Error('404 not found') })
    await waitFor(() => expect(screen.getByText(/older than this app/)).toBeTruthy())
  })

  it('draws the plan from records, not from the scratchpad', async () => {
    // The pod owns the list now, so this renders rather than parses. A client
    // that read the plan out of markdown could disagree with the pod about what
    // the plan said, and the disagreement would be invisible.
    await mount({ get_project: WITH_TASKS })
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))

    await waitFor(() => expect(screen.getByText('Schema and migration')).toBeTruthy())

    // Startable now versus waiting on something is the distinction a person
    // opens this screen to make: t2's dependency has landed, t3's has not.
    expect(screen.getAllByLabelText('ready').length).toBe(1)
    expect(screen.getByText('after t2')).toBeTruthy()

    // A closed task shows its evidence rather than its claim — "done" without
    // proof is the failure the task list exists to prevent.
    expect(screen.getByText(/8f21a0c/)).toBeTruthy()

    // And a blocked row says what it wants, inline, without being opened.
    expect(screen.getByText('needs a token')).toBeTruthy()
  })

  it('can ask for a tick now instead of waiting out the heartbeat', async () => {
    // The third lever, and the one that makes the other two feel like controls:
    // without it, retargeting a project means waiting a quarter of an hour to
    // find out whether it understood you.
    // On the project that is actually running: a blocked or paused one does not
    // offer this, because the pod refuses it — "run now" is about *when*, not
    // about overriding a decision somebody already took.
    const { calls } = await mount({
      get_project: { ...WORKING, scratchpad: SCRATCHPAD, needs_groom: false },
      tick_project: WORKING,
    })
    await waitFor(() => expect(screen.getByText('Audit')).toBeTruthy())
    await userEvent.click(screen.getByText('Audit'))

    await waitFor(() => expect(screen.getByText('Run now')).toBeTruthy())
    await userEvent.click(screen.getByText('Run now'))
    await waitFor(() => expect(calls.some((c) => c.method === 'tick_project')).toBe(true))
  })

  it('does not offer to run a project that is not running', async () => {
    // The pod refuses a forced tick on anything that does not tick, so offering
    // the button would be offering an error.
    await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))
    await waitFor(() => expect(screen.getByText('Resume')).toBeTruthy())
    expect(screen.queryByText('Run now')).toBeNull()
  })
})
