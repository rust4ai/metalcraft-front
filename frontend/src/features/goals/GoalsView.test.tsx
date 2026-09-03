import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

/** The store is a module singleton and outlives `cleanup`, which unmounts the
 *  DOM and nothing else — so an open goal from the previous test would still be
 *  open in the next one, rendering its title twice. Correct behaviour for the
 *  app (switching tabs and back keeps your place); a leak between tests. */
afterEach(async () => {
  const { useGoals } = await import('@/stores/goals')
  useGoals.setState({ goals: [], open: null, journal: [], error: null, busy: {} })
})

/** Stopped, waiting on a person. Its heartbeat is off, so nothing else in the
 *  app will ever raise it again — this is the case the screen is arranged
 *  around. */
const BLOCKED = {
  id: 'goal_billing',
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
  id: 'goal_audit',
  title: 'Audit',
  goal: 'Review rust4ai/bar and open PRs',
  kind: 'audit',
  status: 'active',
  blocked_reason: undefined,
  progress: { done: 1, total: 4 },
  next_tick_at: '2026-09-03T09:00:00Z',
  created_at: '2026-09-02T00:00:00Z',
}

const SCRATCHPAD = `## Goal
Ship Stripe billing in rust4ai/foo

## Plan
- [x] 1. Schema + migration
- [ ] 2. Checkout endpoint

## State
Branch \`goal/billing\`, migration 0004 applied.

## Blockers
(none)
`

async function mount(over: Record<string, unknown> = {}) {
  const calls: { method: string; args?: Record<string, unknown> }[] = []
  const responses: Record<string, unknown> = {
    list_goals: { goals: [WORKING, BLOCKED], active: 1, max_active: 5 },
    get_goal: { ...BLOCKED, scratchpad: SCRATCHPAD, needs_groom: false },
    goal_journal: {
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
    update_goal: BLOCKED,
    create_goal: BLOCKED,
    delete_goal: null,
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
  const { GoalsView } = await import('./GoalsView')
  render(<GoalsView />)
  return { calls }
}

describe('GoalsView', () => {
  it('puts the goal that needs a person first, and says what it wants without being opened', async () => {
    // The whole point of the ordering: a blocked goal is stalled and silent, and
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

  it('shows the plan as a checklist when a goal is opened', async () => {
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))

    await waitFor(() => expect(screen.getByText('1. Schema + migration')).toBeTruthy())
    expect(screen.getByText('2. Checkout endpoint')).toBeTruthy()
    // The journal is loaded with the goal, not after it: a detail screen with a
    // plan and no history is half an answer.
    expect(calls.some((c) => c.method === 'goal_journal')).toBe(true)
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

  it('answers a blocked goal in one step, without also asking for a resume', async () => {
    // Replying *is* saying carry on. Making someone answer and then press
    // Resume would be a second step whose omission looks like being ignored.
    const { calls } = await mount()
    await waitFor(() => expect(screen.getByText('Billing')).toBeTruthy())
    await userEvent.click(screen.getByText('Billing'))
    await waitFor(() => expect(screen.getByLabelText('Answer')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('Answer'), 'Use the test key')
    await userEvent.click(screen.getByText('Answer and carry on'))

    await waitFor(() => {
      const update = calls.find((c) => c.method === 'update_goal')
      expect(update).toBeTruthy()
      expect((update?.args?.update as Record<string, unknown>)?.answer).toBe('Use the test key')
      // no status flip alongside it — the pod un-blocks on the answer
      expect((update?.args?.update as Record<string, unknown>)?.status).toBeUndefined()
    })
  })

  it('tells a fresh pod what a goal is instead of showing an empty list', async () => {
    await mount({ list_goals: { goals: [], active: 0, max_active: 5 } })
    await waitFor(() => expect(screen.getByText('Nothing on the go.')).toBeTruthy())
  })

  it('explains a pod that is older than this app', async () => {
    // A 404 here reads as a broken pod unless it is named, and the fix — update
    // the pod — is not something an error string suggests on its own.
    await mount({ list_goals: new Error('404 not found') })
    await waitFor(() => expect(screen.getByText(/older than this app/)).toBeTruthy())
  })
})
