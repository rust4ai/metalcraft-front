import { describe, expect, it } from 'vitest'
import { COMMANDS, helpText, matching, parse } from './commands'

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
