import { call } from '@/rpc/transport'

/**
 * Open a URL where a link out of this app belongs: the user's browser.
 *
 * Best-effort, in that order — the core knows how to reach the browser, and the
 * fallback covers the web build, where this code *is* in one.
 */
export async function openExternal(url: string) {
  try {
    await call('open_url', { url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/**
 * The absolute URL an anchor points *out* of the app to, or null when the click
 * is the app's own business (a hash, a same-origin route) or a scheme the core
 * refuses to open anyway.
 */
export function externalUrl(href: string | null | undefined): string | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.origin === window.location.origin) return null
  return url.href
}

/**
 * Send every click on an outward link to the browser, wherever in the tree it is.
 *
 * An `<a href>` inside the Tauri window has two behaviours and both are wrong:
 * with `target="_blank"` it does nothing (there is no window handler behind it),
 * and without it the *app* navigates to the page and there is no way back — the
 * shell, the socket and the session are gone. Rather than requiring every anchor
 * in the app to remember that, one capture-phase listener catches the lot; a
 * component only has to write a normal `href`, which keeps hover, the status bar
 * and "copy link" working.
 *
 * `auxclick` is here for the middle button, which navigates just the same.
 *
 * Returns the uninstaller, so a caller in a React effect can hand it straight back.
 */
export function installExternalLinkHandler(): () => void {
  const onClick = (event: MouseEvent) => {
    // Left and middle only: a right-click is the context menu, and a modifier
    // click means the same thing here as a plain one — there are no app windows
    // to open it in besides the browser.
    if (event.defaultPrevented || event.button > 1) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const url = externalUrl(anchor.getAttribute('href'))
    if (!url) return
    event.preventDefault()
    void openExternal(url)
  }
  document.addEventListener('click', onClick, true)
  document.addEventListener('auxclick', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('auxclick', onClick, true)
  }
}
