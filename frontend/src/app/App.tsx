import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { LoginView } from '@/features/onboarding/LoginView'
import { ConnectView } from '@/features/onboarding/ConnectView'
import { useUi } from '@/stores/ui'
import { Gallery } from '@/dev/Gallery'
import { Shell } from './Shell'

/** Dev-only: `?gallery` renders the primitive harness instead of the app. */
const showGallery = import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')

export function App() {
  const { ready, session, info, boot } = useConnection()
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

  // Sign-in and pod connection are full-window takeovers *outside* the shell:
  // there is no pod yet, so there is nothing to put in a sidebar.
  if (!ready) return null
  if (!session) return <LoginView />
  if (!info) return <ConnectView />
  return <Shell />
}
