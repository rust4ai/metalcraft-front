import { describe, expect, it } from 'vitest'
import { newestChat } from './sessions'
import type { ChatSummary } from '@/types'

const chat = (id: string, instance: string, updated: string): ChatSummary => ({
  id,
  instance_id: instance,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: updated,
})

describe('newestChat', () => {
  it('reuses the instance most recent conversation', () => {
    // An instance is long-lived and its conversation is what you come back to;
    // opening it must not scatter one relationship across new transcripts.
    const all = [
      chat('old', 'i1', '2026-08-01T00:00:00Z'),
      chat('new', 'i1', '2026-08-20T00:00:00Z'),
      chat('other', 'i2', '2026-08-22T00:00:00Z'),
    ]
    expect(newestChat(all, 'i1')?.id).toBe('new')
  })

  it('returns nothing for an instance with no chats, so the caller creates one', () => {
    expect(newestChat([chat('a', 'i1', '2026-08-01T00:00:00Z')], 'fresh')).toBeUndefined()
  })

  it('falls back to created_at when a chat has never been updated', () => {
    const all: ChatSummary[] = [
      { id: 'a', instance_id: 'i1', created_at: '2026-08-01T00:00:00Z' },
      { id: 'b', instance_id: 'i1', created_at: '2026-08-21T00:00:00Z' },
    ]
    expect(newestChat(all, 'i1')?.id).toBe('b')
  })
})
