import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { LaunchpadView } from '@/features/onboarding/LaunchpadView'
import { BootScreen } from '@/features/onboarding/WaitScreen'
import { useUi } from '@/stores/ui'
import { Gallery } from '@/dev/Gallery'
import { installExternalLinkHandler } from '@/lib/external'
import { Shell } from './Shell'

/** Dev-only: `?gallery` renders the primitive harness instead of the app. */
const showGallery = import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')

export function App() {
  const { ready, info, boot } = useConnection()
  const checkOwnSource = useUi((s) => s.checkOwnSource)

  // Once connected, find out whether this pod has a provider key of its own —
  // which only *matters* when the account cannot cover inference itself.
  useEffect(() => {
    if (info) void checkOwnSource()
  }, [info, checkOwnSource])

  useEffect(() => {
    void boot()
  }, [boot])

  // One listener for every outward link in the tree: inside the Tauri window a
  // plain anchor either does nothing or navigates the *app* to the page, and
  // there is no way back from that. See `installExternalLinkHandler`.
  useEffect(() => installExternalLinkHandler(), [])

  if (showGallery) return <Gallery />

  // No pod, no shell: there is nothing to put in a sidebar yet, so the Launchpad
  // is a full-window takeover *outside* the frame — and the same component is a
  // normal tab inside it once there is (LAUNCHPAD_PLAN §4).
  //
  // `info` is the whole condition. It used to check the session first, which made
  // sign-in a gate: a pod you run yourself needs no Metalcraft account, and the
  // one screen that could connect it sat behind a demand for an identity that pod
  // never needed.
  //
  // Three states, not two. `!ready` is not "no pod" — it is *no answer yet*, and
  // rendering the Launchpad through it would put "No pod on this account" in
  // front of someone whose pod is about to appear. It gets its own screen.
  //
  // `info` is tested first because boot resolves it first: the core is asked what
  // it is already connected to *before* who we are, so a window that reloads onto
  // a live pod goes straight back to it without waiting on an account lookup it
  // no longer needs an answer to.
  if (info) return <Shell />
  if (!ready) return <BootScreen />
  return <LaunchpadView />
}
