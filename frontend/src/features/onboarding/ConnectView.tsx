import { useEffect } from 'react'
import { Loader2, ServerCog } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { Button } from '@/components/ui/Button'

/**
 * Between sign-in and the fleet: mint a connection token and wait for the pod's
 * API to answer.
 *
 * A pod waking from suspend can take a couple of minutes before its ingress has a
 * healthy backend, so this is a stated wait with an explanation rather than a
 * spinner that looks broken.
 */
export function ConnectView() {
  const { pods, connect, connecting, waking, error, refreshPods } = useConnection()

  useEffect(() => {
    if (pods.length === 1 && !connecting && !error) void connect()
  }, [pods.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-card bg-surface shadow-card">
          {connecting ? (
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          ) : (
            <ServerCog className="h-6 w-6 text-accent" />
          )}
        </div>

        {connecting ? (
          <>
            <h2 className="text-lg font-semibold">Connecting to your pod</h2>
            <p className="mt-2 text-sm text-ink-2">
              {waking
                ? 'If it was asleep this takes a moment — it has to be scheduled and start up.'
                : 'Minting a connection token…'}
            </p>
          </>
        ) : pods.length === 0 ? (
          <>
            <h2 className="text-lg font-semibold">No pod on this account</h2>
            <p className="mt-2 text-sm text-ink-2">
              An agent pod comes with Metalcraft premium. Once you have one it shows up here.
            </p>
            <Button variant="outline" className="mt-6" onClick={() => void refreshPods()}>
              Check again
            </Button>
          </>
        ) : (
          <div className="space-y-2 text-left">
            {pods.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void connect(p.id)}
                className="flex w-full items-center justify-between rounded-card bg-surface px-4 py-3 shadow-card transition-shadow duration-150 hover:shadow-raised"
              >
                <span className="font-medium">{p.slug || p.id}</span>
                <span className="text-xs text-ink-3">{p.status ?? 'ready'}</span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-6">
            <p className="text-sm text-red">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void connect()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
