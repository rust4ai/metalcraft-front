import { describe, expect, it, vi } from 'vitest'
import { COMMANDS, describeCommandError, helpText, matching, parse } from './commands'
import { fleet } from '@/rpc'
import type { DreamReport } from '@/types'

describe('parse', () => {
  it('runs a known command', () => {
    const parsed = parse('/compact')
    expect(parsed.kind).toBe('command')
    expect(parsed.kind === 'command' && parsed.command.name).toBe('compact')
  })

  it('ignores what follows the command word', () => {
    // Someone typing "/compact please" means the command, not a message.
    expect(parse('/compact please').kind).toBe('command')
  })

  it('sends a pasted path as an ordinary message', () => {
    // The reason the rule is not "starts with a slash": people paste absolute
    // paths into chats, and swallowing one as a failed command would be worse
    // than the bug this replaces.
    expect(parse('/Users/amy/notes.md').kind).toBe('message')
    expect(parse('/etc/hosts is the file').kind).toBe('message')
    expect(parse('/usr/local/bin').kind).toBe('message')
  })

  it('names a command-shaped miss instead of spending a turn on it', () => {
    const parsed = parse('/compct')
    expect(parsed.kind).toBe('unknown')
    expect(parsed.kind === 'unknown' && parsed.name).toBe('/compct')
  })

  it('leaves ordinary text alone', () => {
    expect(parse('what is 2/3 of 90?').kind).toBe('message')
    expect(parse('').kind).toBe('message')
  })
})

describe('matching', () => {
  it('lists everything for a bare slash', () => {
    expect(matching('/')).toHaveLength(COMMANDS.length)
  })

  it('narrows by prefix', () => {
    expect(matching('/c').map((c) => c.name)).toEqual(['compact', 'clear'])
    expect(matching('/co').map((c) => c.name)).toEqual(['compact'])
  })

  it('closes once the command word is finished', () => {
    // The menu is for choosing a command; it must not hover over the arguments.
    expect(matching('/compact ')).toEqual([])
    expect(matching('hello')).toEqual([])
  })

  it('offers nothing for a miss', () => {
    expect(matching('/zzz')).toEqual([])
  })
})

describe('helpText', () => {
  it('names every command, including itself', () => {
    const text = helpText()
    for (const c of COMMANDS) expect(text).toContain(`/${c.name}`)
    expect(text).toContain('/help')
  })
})

describe('/dream', () => {
  const command = COMMANDS.find((c) => c.name === 'dream')!

  const report = (over: Partial<DreamReport> = {}): DreamReport => ({
    instance_id: 'i1',
    trigger: 'manual',
    model: 'gpt-5.4',
    started_at: '2026-08-29T03:30:00Z',
    finished_at: '2026-08-29T03:30:42Z',
    stages: [],
    memories_before: 10,
    memories_after: 14,
    captures_pending_before: 7,
    captures_pending_after: 0,
    snapshot_written: true,
    ...over,
  })

  const run = async (r: DreamReport) => {
    vi.spyOn(fleet, 'dream').mockResolvedValue(r)
    return command.run!({ chatId: 'c1', instanceId: 'i1' })
  }

  it('acts on the agent, not the conversation', async () => {
    // Memory outlives any one chat, so the id that matters is the instance's.
    const spy = vi.spyOn(fleet, 'dream').mockResolvedValue(report())
    await command.run!({ chatId: 'c1', instanceId: 'i1' })
    expect(spy).toHaveBeenCalledWith('i1')
  })

  it('says what it distilled and how long it took', async () => {
    const { notice } = await run(report())
    expect(notice).toContain('42s')
    expect(notice).toContain('7 captured turn(s)')
    expect(notice).toContain('4 memories added')
  })

  it('reports a run that only tidied up, without claiming it learned', async () => {
    // A dream that merges duplicates ends with *fewer* memories. Reporting that
    // as "-3 memories added" would read as data loss rather than consolidation.
    const { notice } = await run(report({ memories_before: 14, memories_after: 11 }))
    expect(notice).toContain('3 merged away or faded')
    expect(notice).not.toContain('added')
  })

  it('does not pretend to have worked when there was nothing to do', async () => {
    const { notice } = await run(
      report({ memories_after: 10, captures_pending_before: 0, captures_pending_after: 0 }),
    )
    expect(notice).toContain('Nothing new to distil')
  })

  it('surfaces a failed run rather than reporting success', async () => {
    // The pod answers 200 with the failure inside, because the stages that did
    // succeed did real work. That must not read as a clean run.
    const { notice } = await run(report({ error: 'no inference credential' }))
    expect(notice).toContain('could not finish')
    expect(notice).toContain('no inference credential')
  })
})

describe('describeCommandError', () => {
  it('blames the pod version for a route it does not serve, whatever the path', () => {
    // `/dream` reaches `/agents/instances/…`, not `/chats/…`. Pinning the prefix
    // made an old pod's 404 on it read as the pod's own words instead.
    expect(describeCommandError('404 /agents/instances/i1/memory/dream:', 'dream')).toContain(
      'too old for /dream',
    )
    expect(describeCommandError('404 /chats/c1/compact:', 'compact')).toContain('too old')
  })

  it('leaves the pod own account of a real failure alone', () => {
    expect(describeCommandError('404 /chats/c1/compact: no such chat', 'compact')).toBe(
      '404 /chats/c1/compact: no such chat',
    )
    expect(describeCommandError('500 boom', 'dream')).toBe('500 boom')
  })
})
