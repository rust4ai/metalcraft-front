import { describe, expect, it } from 'vitest'
import { describeTool, truncateTarget } from './describeTool'

describe('describeTool', () => {
  it('gives the agent tools a verb a person would use', () => {
    expect(describeTool('read_file', { path: 'a.rs' })).toEqual({ verb: 'Read', target: 'a.rs' })
    expect(describeTool('bash', { command: 'npm run build' }).verb).toBe('Run')
  })

  it('humanizes a pack tool by dropping the pack prefix', () => {
    // `mdrv_` is the drive pack; the chip already implies where it came from, so
    // the action is what earns the space.
    expect(describeTool('mdrv_upload_file', {}).verb).toBe('Upload file')
  })

  it('finds the recognizable argument, preferring the most specific', () => {
    expect(describeTool('grep', { pattern: 'x', path: 'src/' }).target).toBe('src/')
    expect(describeTool('web_fetch', { url: 'https://example.com' }).target).toBe('https://example.com')
  })

  it('has no target when nothing in the args is recognizable', () => {
    expect(describeTool('mem_stats', { limit: 5 }).target).toBeUndefined()
    expect(describeTool('bash', null).target).toBeUndefined()
  })
})

describe('truncateTarget', () => {
  it('keeps the filename by truncating a path from the left', () => {
    const out = truncateTarget('src/components/session/ChurnSchedule.tsx', 24)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('ChurnSchedule.tsx')).toBe(true)
  })

  it('truncates a non-path from the right', () => {
    expect(truncateTarget('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`)
  })

  it('leaves a short target alone', () => {
    expect(truncateTarget('a.rs')).toBe('a.rs')
  })
})
