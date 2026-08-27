import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Transport } from '@/rpc/transport'

afterEach(cleanup)

/**
 * A link in the window is the one click that can end the session: navigating the
 * webview replaces the app with a web page and there is no way back to it. These
 * cases hold the line that any anchor — not only the ones a component remembered
 * to wire up — leaves through the core instead.
 */
async function mountWithHandler(text: string, href: string) {
  vi.resetModules()
  const transport = await import('@/rpc/transport')
  const call = vi.fn(async () => null as never)
  transport.setTransport({ call, listen: vi.fn(async () => () => {}) } as Transport)
  const { installExternalLinkHandler } = await import('./external')
  const uninstall = installExternalLinkHandler()
  const view = render(<a href={href}>{text}</a>)
  return { call, uninstall, link: view.getByText(text) }
}

describe('installExternalLinkHandler', () => {
  it('sends a plain anchor to the browser rather than the window', async () => {
    const { call, uninstall, link } = await mountWithHandler(
      'Profile',
      'https://packs.metalcraftai.com/@mnote',
    )
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('open_url', { url: 'https://packs.metalcraftai.com/@mnote' }),
    )
    uninstall()
  })

  it('leaves the app its own links', async () => {
    // An in-app hash or same-origin route is navigation the app *wants*.
    const { call, uninstall, link } = await mountWithHandler('Settings', '#settings')
    fireEvent.click(link)
    expect(call).not.toHaveBeenCalled()
    uninstall()
  })

  it('does not hand the shell a scheme the core would refuse', async () => {
    const { call, uninstall, link } = await mountWithHandler('Mail', 'mailto:admazzola@gmail.com')
    fireEvent.click(link)
    expect(call).not.toHaveBeenCalled()
    uninstall()
  })

  it('stops once uninstalled, so a remounted app does not open two windows', async () => {
    const { call, uninstall, link } = await mountWithHandler('Docs', 'https://metalcraftai.com/docs')
    uninstall()
    fireEvent.click(link)
    expect(call).not.toHaveBeenCalled()
  })
})
