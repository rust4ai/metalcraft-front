import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionView } from './SessionView'
import { useUi } from '@/stores/ui'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { useTurnDebug } from '@/stores/turnDebug'
import { useMemory } from '@/stores/memory'
import type { AgentInstance } from '@/types'

vi.mock('@/rpc', async () => {
  const actual = await vi.importActual<typeof import('@/rpc')>('@/rpc')
  return {
    ...actual,
    // The Schedules mode asks the pod what points at this agent. An empty list
    // is a real answer and the one this fixture gives.
    fleet: { ...actual.fleet, flows: vi.fn(async () => []) },
  }
})

const INSTANCE: AgentInstance = {
  id: 'i1',
  name: 'Amy',
  agent_pack: 'metalcraft',
  agent_preset: 'assistant',
  persona: 'amy',
  origin: { kind: 'workshop' },
  created_at: new Date().toISOString(),
  last_active_at: new Date().toISOString(),
  conversation_count: 1,
}

beforeEach(() => {
  localStorage.clear()
  useFleet.setState({ instances: [INSTANCE], loaded: true, status: {} })
  // A session already open, so `SessionView` never reaches for the transport.
  useSessions.setState({
    byInstance: {
      i1: {
        chatId: 'c1',
        modelName: 'gpt-5.4',
        stopping: false,
        error: null,
        transcript: {
          items: [],
          busy: false,
          thinking: false,
          plan: [],
          queued: [],
          sessionId: undefined,
        },
      },
    },
    opening: {},
    conversations: {},
    loadingConversations: {},
  } as never)
  useTurnDebug.setState({ loading: false, sessionId: null, turns: [], detail: null, notice: null })
  // Memory already read: the panel renders a sentence rather than its content
  // until the pod has answered, and this test is about the routing.
  useMemory.setState({
    byInstance: {
      i1: { instance_id: 'i1', base: null, shipped: 2, learned: 1, forgotten: 0, sample: [], system: null },
    },
    loading: {},
    error: {},
    dreaming: {},
    lastDream: {},
  } as never)
  useUi.setState({ sessionMode: {} })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('session modes', () => {
  it('opens on the chat, with its composer', async () => {
    render(<SessionView instanceId="i1" />)
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByPlaceholderText(/Ask this agent/)).toBeTruthy()
  })

  it('every mode opens something — none of them is a label on an empty pane', async () => {
    render(<SessionView instanceId="i1" />)

    // This is the §0 test. A mode row copied from a screenshot is worth nothing
    // if three of its four buttons lead to a blank rectangle, so each one is
    // asserted to render its own content rather than merely to become current.
    await userEvent.click(screen.getByRole('button', { name: 'Runs' }))
    await waitFor(() => expect(screen.getByText('This conversation')).toBeTruthy())
    expect(screen.getByText(/No tools run in this conversation yet/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Memory' }))
    await waitFor(() => expect(screen.getByText('Knows')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: 'Schedules' }))
    await waitFor(() =>
      expect(screen.getByText(/does not run on its own|Runs on its own/)).toBeTruthy(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Chat' }))
    await waitFor(() => expect(screen.getByPlaceholderText(/Ask this agent/)).toBeTruthy())
  })

  it('keeps the mode per agent, so switching away and back returns to it', async () => {
    const { rerender } = render(<SessionView instanceId="i1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Memory' }))
    expect(useUi.getState().sessionMode.i1).toBe('memory')

    // A second agent starts on its own chat rather than inheriting the first's
    // room — the bug a single global mode would have.
    useFleet.setState({ instances: [INSTANCE, { ...INSTANCE, id: 'i2', name: 'Dusty' }] })
    rerender(<SessionView instanceId="i2" />)
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page')

    rerender(<SessionView instanceId="i1" />)
    expect(screen.getByRole('button', { name: 'Memory' }).getAttribute('aria-current')).toBe('page')
  })

  it('forgets the mode of an agent that is gone', () => {
    useUi.setState({ sessionMode: { i1: 'memory', gone: 'runs' } })
    useUi.getState().prune(['i1'])
    expect(useUi.getState().sessionMode).toEqual({ i1: 'memory' })
  })
})
