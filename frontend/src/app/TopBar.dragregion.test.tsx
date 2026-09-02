import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TopBar } from './TopBar'
import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { useDiagnostics } from '@/stores/diagnostics'
import { FLEET_TAB, useUi } from '@/stores/ui'

/**
 * Whether Tauri would drag the window from a given element.
 *
 * A verbatim transcription of `isDragRegion` from tauri-2.11.5's
 * `src/window/scripts/drag.js`, because the rule is not what it looks like and
 * getting it wrong produces a window that cannot be moved — which no other test
 * in this suite can see, and which the browser harness cannot see either.
 *
 * The part that matters: a **bare** `data-tauri-drag-region` answers
 * `el === composedPath[0]`. It drags only when the click lands on that exact
 * element, so a bare attribute on a *wrapper* silently blocks dragging for
 * everything inside it. `deep` is the one that means "this subtree".
 */
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'])
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
])

function isClickableElement(el: Element): boolean {
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') ||
    (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') ||
    INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '')
  )
}

/** The ancestor chain, which is what `composedPath()` is outside a shadow root. */
function pathOf(el: Element): Element[] {
  const path: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) path.push(n)
  return path
}

function isDragRegion(path: Element[]): boolean {
  for (const el of path) {
    // Tauri skips anything that is not an HTMLElement — notably SVG icons.
    if (!(el instanceof (globalThis as never as { HTMLElement: typeof HTMLElement }).HTMLElement)) {
      continue
    }
    const attr = el.getAttribute('data-tauri-drag-region')
    if (isClickableElement(el) && attr === null) return false
    if (attr === null) continue
    if (attr === 'false') return false
    if (attr === 'deep') return true
    if (attr === '' || attr === 'true') return el === path[0]
  }
  return false
}

const draggableFrom = (el: Element) => isDragRegion(pathOf(el))

beforeEach(() => {
  useConnection.setState({
    info: { name: 'metalcraft-agent', version: '0.31.0' },
    pod: { slug: 'amy', url: 'https://amy.metalcraftai.com' },
    session: { email: 'a@b.com', premium: true },
  } as never)
  useFleet.setState({ instances: [], presets: [], loaded: true, status: {} } as never)
  useDiagnostics.setState({ entries: [], seenAt: Date.now() })
  useUi.setState({ tabs: [FLEET_TAB], activeKey: 'fleet' })
})
afterEach(cleanup)

describe('the window bar is draggable', () => {
  it('drags from the bar itself', () => {
    const { container } = render(<TopBar />)
    const header = container.querySelector('header')!
    expect(header.getAttribute('data-tauri-drag-region')).toBe('deep')
    expect(draggableFrom(header)).toBe(true)
  })

  it('drags from every passive thing in it, at any depth', () => {
    const { container } = render(<TopBar />)
    // The product mark, the breadcrumb, the account — all nested two or three
    // levels down. Under a bare attribute every one of these was dead, which is
    // how this bar shipped unable to move the window.
    for (const text of ['Metalcraft', 'metalcraft-agent', 'Home', 'a@b.com']) {
      const el = screen.getByText(text)
      expect(draggableFrom(el), `dragging from "${text}"`).toBe(true)
    }
    // Including the wrapper divs, which is what a click on empty bar space hits.
    for (const div of container.querySelectorAll('header > div')) {
      expect(draggableFrom(div)).toBe(true)
    }
  })

  it('still lets the controls be controls', () => {
    render(<TopBar />)
    for (const name of [/sidebar/i, /Error log/, /^Theme:/, /details/i, /Search/]) {
      const button = screen.getByRole('button', { name })
      expect(draggableFrom(button), `${button.getAttribute('aria-label')} should click`).toBe(false)
    }
  })

  it('has no bare drag attribute anywhere — the shape that caused the bug', () => {
    const { container } = render(<TopBar />)
    for (const el of container.querySelectorAll('[data-tauri-drag-region]')) {
      // Bare (`""`) or `"true"` means "only a direct hit on me", which on any
      // element that wraps something else is a dead zone rather than a region.
      expect(el.getAttribute('data-tauri-drag-region')).toBe('deep')
    }
  })
})
