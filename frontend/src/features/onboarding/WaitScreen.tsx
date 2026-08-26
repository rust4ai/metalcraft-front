import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * The full-window wait: a named thing being waited on, not a spinner.
 *
 * Every screen before the shell is a claim about the world — *you have no pod*,
 * *you are not signed in* — and each one is only true once someone has looked.
 * This is what stands in the gap while nobody has, and the title is always the
 * question being asked rather than a verb about the app.
 */
export function WaitScreen({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-card bg-surface shadow-card">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-ink-2">{detail}</p>
      </div>
    </div>
  )
}

/**
 * Boot: the core has not said what it is connected to, or who we are.
 *
 * What was here was `return null` — a blank window for as long as the core took,
 * which on a cold start is the first thing anyone sees of this app. The window
 * cannot honestly show the Launchpad yet (it does not know there is no pod) or
 * the shell (it does not know there is one), so it says which of those it is
 * finding out.
 *
 * Held back for a beat, because a boot that answers in 40ms should not flash a
 * spinner on its way to the real screen — the wait is only worth naming once it
 * is long enough to notice.
 */
export function BootScreen() {
  const slow = useAfter(150)
  if (!slow) return null
  return (
    <WaitScreen
      title="Looking for your pod"
      detail="Checking what this window is connected to, and what is on your account."
    />
  )
}

/** True once `ms` has passed since mount. */
function useAfter(ms: number): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setPast(true), ms)
    return () => clearTimeout(id)
  }, [ms])
  return past
}
