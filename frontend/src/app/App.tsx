import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { LoginView } from '@/features/onboarding/LoginView'
import { ConnectView } from '@/features/onboarding/ConnectView'
import { FleetView } from '@/features/fleet/FleetView'
import { SessionView } from '@/features/session/SessionView'
import { InterfaceSourceView } from '@/features/onboarding/InterfaceSourceView'
import { useUi } from '@/stores/ui'
import { TitleBar } from './TitleBar'

export function App() {
  const { ready, session, info, boot } = useConnection()
  const { view, checkSource, markSourceBound } = useUi()

  // Once connected, find out whether this pod can actually think before showing
  // a fleet the user cannot talk to.
  useEffect(() => {
    if (info) void checkSource()
  }, [info, checkSource])

  useEffect(() => {
    void boot()
  }, [boot])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="min-h-0 flex-1">
        {!ready ? null : !session ? (
          <LoginView />
        ) : !info ? (
          <ConnectView />
        ) : view.kind === 'source' ? (
          <InterfaceSourceView onDone={markSourceBound} />
        ) : view.kind === 'session' ? (
          <SessionView instanceId={view.instanceId} />
        ) : (
          <FleetView />
        )}
      </main>
    </div>
  )
}
