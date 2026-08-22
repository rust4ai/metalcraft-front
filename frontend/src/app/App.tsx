import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { LoginView } from '@/features/onboarding/LoginView'
import { ConnectView } from '@/features/onboarding/ConnectView'
import { FleetView } from '@/features/fleet/FleetView'
import { TitleBar } from './TitleBar'

export function App() {
  const { ready, session, info, boot } = useConnection()

  useEffect(() => {
    void boot()
  }, [boot])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="min-h-0 flex-1">
        {!ready ? null : !session ? <LoginView /> : !info ? <ConnectView /> : <FleetView />}
      </main>
    </div>
  )
}
