import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { LaunchpadView } from '@/features/onboarding/LaunchpadView'
import { useUi } from '@/stores/ui'
import { Gallery } from '@/dev/Gallery'
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

  if (showGallery) return <Gallery />

  // No pod, no shell: there is nothing to put in a sidebar yet, so the Launchpad
  // is a full-window takeover *outside* the frame — and the same component is a
  // normal tab inside it once there is (LAUNCHPAD_PLAN §4).
  //
  // `info` is the whole condition. It used to check the session first, which made
  // sign-in a gate: a pod you run yourself needs no Metalcraft account, and the
  // one screen that could connect it sat behind a demand for an identity that pod
  // never needed.
  if (!ready) return null
  if (!info) return <LaunchpadView />
  return <Shell />
}
