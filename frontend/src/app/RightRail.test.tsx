import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RightRail } from './RightRail'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { useConnection } from '@/stores/connection'
import { useDiagnostics } from '@/stores/diagnostics'
import { useLayout } from '@/stores/layout'
import { FLEET_TAB, useUi } from '@/stores/ui'
import type { AgentInstance, Diagnostic } from '@/types'

const INSTANCE: AgentInstance = {
  id: 'i1',
  name: 'Amy',
  agent_pack: 'amy_kitchen',
  agent_preset: 'amy',
  persona: 'amy-host',
  origin: { kind: 'workshop' },
  created_at: '2026-08-30T10:00:00Z',
  last_active_at: '2026-09-01T10:00:00Z',
  conversation_count: 3,
}

const diagnostic = (level: Diagnostic['level']): Diagnostic => ({
  id: 'd1',
  at: Date.now(),
  level,
  source: 'octaweave_status',
  origin: 'core',
  message: 'the pod would not list its integrations',
  count: 1,
})

/** A healthy pod on an account that can pay, which is the "nothing to say" case. */
function healthy() {
  useConnection.setState({
    info: { name: 'metalcraft-agent', version: '0.31.0' },
    pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
    session: { email: 'a@b.com', premium: true },
  } as never)
  useUi.setState({
    inference: { ready: true, credential: 'pod_token', gateway: true },
    ownSource: false,
  })
  useDiagnostics.setState({ entries: [], seenAt: Date.now() })
}

beforeEach(() => {
  localStorage.clear()
  useLayout.setState({ railSections: {}, railWidth: 368, railOpen: true })
  useFleet.setState({ instances: [INSTANCE], presets: [], loaded: true, status: {} })
  useSessions.setState({
    byInstance: {
      i1: {
        chatId: 'chat-abc',
        modelName: 'gpt-5.4',
        stopping: false,
        error: null,
        transcript: { items: [], busy: false, thinking: false, plan: [], queued: [] },
      },
    },
  } as never)
  useUi.setState({ tabs: [FLEET_TAB, { key: 'session:i1', view: { kind: 'session', instanceId: 'i1' } }], activeKey: 'session:i1' })
  healthy()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('the inspector', () => {
  it('folds a section, and remembers it', async () => {
    render(<RightRail />)
    // Open by default, so its contents are on screen.
    expect(screen.getByText('amy_kitchen')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Agent/ }))
    expect(screen.queryByText('amy_kitchen')).toBe(null)
    // Persisted, not local: the rail is re-rendered constantly as turns land,
    // and a fold that reopened on every frame would be worse than no fold.
    expect(useLayout.getState().railSections.agent).toBe(false)
  })

  it('leads with what the agent is doing, not with what it is made of', () => {
    render(<RightRail />)
    expect(screen.getByText('Ready')).toBeTruthy()

    useSessions.setState({
      byInstance: {
        i1: {
          chatId: 'chat-abc',
          modelName: 'gpt-5.4',
          stopping: false,
          error: null,
          transcript: { items: [], busy: true, thinking: true, plan: [], queued: [] },
        },
      },
    } as never)
    cleanup()
    render(<RightRail />)
    expect(screen.getByText('Thinking')).toBeTruthy()
  })

  it('keeps Checks shut and silent when there is nothing to say', () => {
    render(<RightRail />)
    const checks = screen.getByRole('button', { name: /Checks/ })
    expect(checks.getAttribute('aria-expanded')).toBe('false')
    // No dot: a rail that badges itself when everything is fine teaches people
    // to ignore the badge, which costs the one time it matters.
    expect(checks.querySelector('.bg-red, .bg-orange')).toBe(null)
  })

  it('badges the collapsed Checks when a turn would be refused', () => {
    // A gateway-billed pod on a non-premium account: the credential is perfect
    // and the turn is still refused, which is the case a "no key" reading would
    // send someone hunting for the wrong thing.
    useConnection.setState({ session: { email: 'a@b.com', premium: false } } as never)
    render(<RightRail />)

    const checks = screen.getByRole('button', { name: /Checks/ })
    expect(checks.querySelector('.bg-red')).toBeTruthy()

    // And the row says which problem it is.
    userEvent.click(checks)
    return screen.findByText(/needs premium/).then((el) => expect(el).toBeTruthy())
  })

  it('badges the collapsed Checks for an unread failure in the log', async () => {
    useDiagnostics.setState({ entries: [diagnostic('error')], seenAt: 0 })
    render(<RightRail />)
    expect(screen.getByRole('button', { name: /Checks/ }).querySelector('.bg-red')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Checks/ }))
    expect(screen.getByText(/1 new, 1 failed/)).toBeTruthy()
  })

  it('shows the pod, not an agent, away from a session', () => {
    useUi.setState({ tabs: [FLEET_TAB], activeKey: 'fleet' })
    render(<RightRail />)
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('v0.31.0')).toBeTruthy()
  })
})
