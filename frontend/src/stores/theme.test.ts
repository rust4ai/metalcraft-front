import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Fresh module graph per case: the store reads localStorage and writes the
 *  document at construction, so both are only testable by re-importing. */
async function fresh() {
  vi.resetModules()
  return (await import('./theme')).useTheme
}

const attr = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme', () => {
  it('follows the system with no attribute until asked otherwise', async () => {
    const theme = await fresh()
    expect(theme.getState().theme).toBe('system')
    // Absent, not `"system"`: index.css falls back to `color-scheme: light dark`
    // only when the attribute is missing, so writing a value here would pin the
    // app to the light half of every pair.
    expect(attr()).toBe(null)
  })

  it('writes the document and remembers the choice', async () => {
    const theme = await fresh()
    theme.getState().set('dark')
    expect(attr()).toBe('dark')

    const reloaded = await fresh()
    expect(reloaded.getState().theme).toBe('dark')
    expect(attr()).toBe('dark')
  })

  it('applies a restored choice at construction, not on first render', async () => {
    localStorage.setItem('mc.theme', 'light')
    await fresh()
    // Already on the document before any component has mounted — an effect
    // would show one frame of the wrong palette on every launch.
    expect(attr()).toBe('light')
  })

  it('cycles back to system, so the default stays reachable', async () => {
    const theme = await fresh()
    theme.getState().cycle()
    expect(theme.getState().theme).toBe('light')
    theme.getState().cycle()
    expect(theme.getState().theme).toBe('dark')
    theme.getState().cycle()
    expect(theme.getState().theme).toBe('system')
    expect(attr()).toBe(null)
  })

  it('ignores a stored value it does not recognise', async () => {
    localStorage.setItem('mc.theme', 'solarized')
    const theme = await fresh()
    expect(theme.getState().theme).toBe('system')
    expect(attr()).toBe(null)
  })

  it('survives storage it cannot write', async () => {
    const theme = await fresh()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    // The choice still applies to this window; only its persistence is lost.
    expect(() => theme.getState().set('dark')).not.toThrow()
    expect(attr()).toBe('dark')
    expect(theme.getState().theme).toBe('dark')
    setItem.mockRestore()
  })
})
