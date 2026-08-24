import { useState } from 'react'
import { Server } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { Button } from '@/components/ui/Button'

/**
 * A pod you run — on a VPS, in a homelab, or on this machine
 * (LAUNCHPAD_PLAN §3.1).
 *
 * The mechanism is `connect_pod_url` and it has been complete for weeks. What it
 * did not have was an entrance: it lived behind a grey text link at the bottom of
 * the sign-in screen, which meant that the moment you signed in it became
 * unreachable — and *signed in with no pod* is exactly the person it is for.
 *
 * A pod is always something at a URL (LAUNCHPAD_PLAN §2), and this is the half
 * where the URL is yours: no hub, no minted token, no slug anywhere but here.
 * The key is entered and sent renderer → core, which is the safe direction, and
 * never comes back.
 *
 * Nothing about the app past this point differs. There is no self-hosted mode —
 * only a pod that got its address from you instead of from the control plane.
 */
export function OwnPodCard() {
  const connectDirect = useConnection((s) => s.connectDirect)
  const connecting = useConnection((s) => s.connecting)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [failed, setFailed] = useState<string | null>(null)

  async function submit() {
    setFailed(null)
    // Returned rather than stored: a typo in a URL belongs beside the field that
    // has the typo, not in a banner at the top of the screen.
    const message = await connectDirect(url.trim(), key)
    if (message) setFailed(message)
  }

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <Server className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">A pod you run</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Your own agent host, on a VPS or this machine. No account needed — it pays for its
            own thinking with its own provider key.
          </p>
        </div>
      </header>

      <div className="mt-4 space-y-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://pod.example.com — or http://localhost:3002"
          aria-label="Pod URL"
          className="h-9 w-full rounded-control bg-field px-3 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-accent"
        />
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          type="password"
          placeholder="WORKSHOP_API_KEY"
          aria-label="Pod key"
          className="h-9 w-full rounded-control bg-field px-3 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-accent"
        />
        <Button size="sm" disabled={connecting || !url.trim()} onClick={() => void submit()}>
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>

      {failed && <p className="mt-3 text-[12.5px] text-red">{failed}</p>}

      <p className="mt-3 text-[11px] text-ink-3">
        Signed in or not, this connects the same way. What an account adds on top is credits,
        registry identity and the WhatsApp/SMS gateway.
      </p>
    </section>
  )
}
