import { create } from 'zustand'

/**
 * Light, dark, or whatever the OS says (HARNESS_UI_PLAN §4, H1).
 *
 * `index.css` has always honoured `data-theme` — every colour is a `light-dark()`
 * pair driven by one `color-scheme` declaration, and the two override blocks for
 * an explicit choice were written at the same time as the tokens. Nothing ever
 * set the attribute, so the app has been on system-follows since the day the
 * palette landed. This store is the missing half.
 *
 * **Three states, not two.** A toggle that only knows light and dark has to pick
 * one at first run, and whichever it picks is wrong for half of everyone. So the
 * default is `system` — the attribute is *removed* rather than set to a guess —
 * and it stays that way until someone expresses a preference. Cycling goes
 * system → light → dark → system, so the default is reachable again after a
 * choice, which is the state most toggles strand you out of.
 *
 * Local, like the layout: the pod holds no opinion about how this window looks.
 */
export type Theme = 'system' | 'light' | 'dark'

const KEY = 'mc.theme'

const ORDER: Theme[] = ['system', 'light', 'dark']

/** Write-through to the document. `system` means *no* attribute: `index.css`
 *  falls back to `color-scheme: light dark`, which is the OS's answer. */
function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

function load(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  } catch {
    return 'system'
  }
}

interface ThemeState {
  theme: Theme
  set: (theme: Theme) => void
  /** system → light → dark → system. */
  cycle: () => void
}

export const useTheme = create<ThemeState>((set, get) => {
  const initial = load()
  // At store construction rather than in an effect: a component mounting and
  // *then* applying the theme is a flash of the wrong palette on every launch.
  apply(initial)

  return {
    theme: initial,
    set: (theme) => {
      apply(theme)
      set({ theme })
      try {
        localStorage.setItem(KEY, theme)
      } catch {
        // A webview with storage disabled forgets the choice on quit. Cosmetic,
        // and not worth failing over — the same rule the layout store follows.
      }
    },
    cycle: () => get().set(ORDER[(ORDER.indexOf(get().theme) + 1) % ORDER.length]!),
  }
})

/** What the button should say it will do — the label names the *current* state,
 *  and the title names the next one, because a control that only names its
 *  destination cannot tell you where you are. */
export function themeLabel(theme: Theme): string {
  return theme === 'system' ? 'Theme: system' : theme === 'light' ? 'Theme: light' : 'Theme: dark'
}
