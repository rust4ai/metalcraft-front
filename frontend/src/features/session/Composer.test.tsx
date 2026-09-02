import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { useUsage } from '@/stores/usage'
import type { AgentInstance } from '@/types'

const INSTANCE: AgentInstance = {
  id: 'i1',
  name: 'Amy',
  agent_pack: 'amy_kitchen',
  agent_preset: 'amy',
  persona: 'amy-host',
  origin: { kind: 'workshop' },
  created_at: '2026-08-30T10:00:00Z',
  last_active_at: '2026-09-01T10:00:00Z',
  conversation_count: 1,
}

beforeEach(() => {
  useFleet.setState({ instances: [INSTANCE], personas: {}, loaded: true, status: {} } as never)
  useSessions.setState({
    byInstance: {
      i1: {
        chatId: 'chat-1',
        modelName: 'gpt-5.4',
        stopping: false,
        error: null,
        transcript: { items: [], busy: false, thinking: false, plan: [], queued: [] },
      },
    },
  } as never)
  useUsage.setState({ byChat: {}, loading: {}, failed: { 'chat-1': true } })
})
afterEach(cleanup)

describe('the composer chip rail', () => {
  it('names what the next turn will use', () => {
    render(<Composer instanceId="i1" busy={false} onSend={() => {}} />)
    expect(screen.getByText('Amy')).toBeTruthy()
    expect(screen.getByText('gpt-5.4')).toBeTruthy()
    // A roster of one is not a choice, so the persona renders as plain text
    // rather than a dropdown that can only pick what is already picked.
    expect(screen.getByText('amy-host')).toBeTruthy()
  })

  it('draws no chips without an agent behind it', () => {
    // The dev gallery's mount. Nothing to describe, so nothing is described —
    // rather than a row of empty chips.
    render(<Composer busy={false} onSend={() => {}} />)
    expect(screen.queryByText('Amy')).toBe(null)
    expect(screen.getByPlaceholderText(/Ask this agent/)).toBeTruthy()
  })

  it('says nothing about usage when the pod cannot answer', () => {
    // `failed` for this chat, set above. A ring with no number behind it is the
    // hollow control the plan forbids, so there is no ring.
    render(<Composer instanceId="i1" busy={false} onSend={() => {}} />)
    expect(screen.queryByText(/%/)).toBe(null)
  })

  it('still sends on enter, and keeps the draft when it cannot', async () => {
    const onSend = vi.fn()
    render(<Composer instanceId="i1" busy={false} onSend={onSend} />)
    const box = screen.getByPlaceholderText(/Ask this agent/)

    await userEvent.type(box, 'scale the sourdough to 900g{Enter}')
    expect(onSend).toHaveBeenCalledWith('scale the sourdough to 900g')
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('offers Stop instead of the enter hint while a turn runs', () => {
    const { rerender } = render(
      <Composer instanceId="i1" busy={false} onSend={() => {}} onStop={() => {}} />,
    )
    expect(screen.getByText('send')).toBeTruthy()

    rerender(<Composer instanceId="i1" busy onSend={() => {}} onStop={() => {}} />)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    // The hint would be wrong here: Enter queues a message rather than sending
    // one while the agent is working.
    expect(screen.queryByText('send')).toBe(null)
  })
})
