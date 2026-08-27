import { describe, expect, it } from 'vitest'
import { STALE_AFTER_MS, isStale, partitionByActivity } from './activity'
import type { AgentInstance } from '@/types'

const NOW = Date.parse('2026-08-24T12:00:00Z')

function agent(id: string, fields: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id,
    agent_preset: 'assistant',
    name: id,
    persona: 'default',
    origin: { kind: 'ui' },
    created_at: new Date(NOW).toISOString(),
    last_active_at: new Date(NOW).toISOString(),
    ...fields,
  } as AgentInstance
}

const ago = (ms: number) => new Date(NOW - ms).toISOString()
const DAY = 24 * 60 * 60 * 1000

describe('fleet activity', () => {
  it('keeps an agent touched inside the window out of history', () => {
    expect(isStale(agent('a', { last_active_at: ago(2 * DAY) }), NOW)).toBe(false)
    // The boundary belongs to the live list — "3 days" should not shelve
    // something last used the same hour three mornings ago.
    expect(isStale(agent('a', { last_active_at: ago(STALE_AFTER_MS) }), NOW)).toBe(false)
    expect(isStale(agent('a', { last_active_at: ago(STALE_AFTER_MS + 1) }), NOW)).toBe(true)
  })

  it('dates a never-chatted agent by when it was created', () => {
    // A freshly spawned agent has no activity yet. Reading that as "no activity
    // in three days" would file the one you just made under History.
    const fresh = agent('new', { last_active_at: '', created_at: ago(60_000) })
    expect(isStale(fresh, NOW)).toBe(false)

    const abandoned = agent('old', { last_active_at: '', created_at: ago(10 * DAY) })
    expect(isStale(abandoned, NOW)).toBe(true)
  })

  it('leaves an undateable agent in the live list', () => {
    expect(isStale(agent('a', { last_active_at: 'not a date', created_at: '' }), NOW)).toBe(false)
  })

  it('splits the fleet, keeping live order and sorting history newest first', () => {
    const { active, history } = partitionByActivity(
      [
        agent('yesterday', { last_active_at: ago(DAY) }),
        agent('a-week', { last_active_at: ago(7 * DAY) }),
        agent('now', { last_active_at: ago(1000) }),
        agent('a-month', { last_active_at: ago(30 * DAY) }),
        agent('four-days', { last_active_at: ago(4 * DAY) }),
      ],
      NOW,
    )
    expect(active.map((i) => i.id)).toEqual(['yesterday', 'now'])
    expect(history.map((i) => i.id)).toEqual(['four-days', 'a-week', 'a-month'])
  })
})
