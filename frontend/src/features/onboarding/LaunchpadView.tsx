import { useEffect } from 'react'
import { Check, ExternalLink, Loader2, ServerCog, Sparkles } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { OwnPodCard } from './OwnPodCard'
import { SignInCard } from './SignInCard'

/**
 * The app without a pod — and the way out of it (`LAUNCHPAD_PLAN.md`).
 *
 * What stood here was a wall with a refresh button on it: *No pod on this
 * account · Check again*. Both things this app could have done for that person
 * were one screen away and unreachable — they could have connected a pod they
 * run (built, but its only entrance was behind them on the sign-in screen), and
 * they could have been sold one (never built at all).
 *
 * So this is not "the app minus a pod". It is the surface that gets you one,
 * with three doors that all end in the same place: `info` is set and the shell
 * mounts. A pod on the account, a pod you run, or an account that comes with one.
 *
 * **It outlives onboarding** (LAUNCHPAD_PLAN §4). Switching machines, adding a
 * second pod and reconnecting a self-hosted one are ordinary acts, not first-run
 * acts, so this is also a normal tab — which is why every piece of state it
 * shows is read from the connection store rather than passed in by a wizard.
 * `info` is the only thing that tells it which situation it is in.
 */
export function LaunchpadView() {
  const { pods, connect, connecting, waking, error, refreshPods, session, info, pod } =
    useConnection()

  // Exactly as narrow as it has always been: one pod on the account and nothing
  // connected yet. A picker for a list of one is a speed bump — but a Launchpad
  // that auto-connects while you are trying to reach the pod you run yourself
  // would be worse, so `info` gates it and the in-shell tab never fires it.
  useEffect(() => {
    if (!info && pods.length === 1 && !connecting && !error) void connect()
  }, [pods.length, info]) // eslint-disable-line react-hooks/exhaustive-deps

  if (connecting) return <Connecting waking={waking} />

  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface shadow-card">
            <ServerCog className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{info ? 'Pods' : 'Connect a pod'}</h1>
            <p className="text-sm text-ink-2">
              {info
                ? 'Where your agents run. Connecting to another one switches this window to it.'
                : 'Your agents run on a pod. It can be one we host, or one you do.'}
            </p>
          </div>
        </header>

        {/* Order is the argument: what you have, then how to get one, then the
            way that needs nothing from us. The pod you run is last because it is
            the alternative — never hidden, because for a self-hoster it is the
            only door that works, and never first, because for everyone else the
            hosted one is. */}
        <div className="flex flex-col gap-3">
          {session ? (
            <>
              <PodsCard
                pods={pods}
                activeSlug={pod?.slug}
                onConnect={(id) => void connect(id)}
                onRefresh={() => void refreshPods()}
              />
              <GetAPodCard premium={session.premium} hasPod={pods.length > 0} />
            </>
          ) : (
            <SignInCard />
          )}

          <OwnPodCard />
        </div>

        {error && (
          <div className="mt-4 rounded-card bg-red-tint px-4 py-3">
            <p className="text-[12.5px] text-red">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void connect()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A pod waking from suspend can take a couple of minutes before its ingress has a
 * healthy backend, so this is a stated wait with an explanation rather than a
 * spinner that looks broken.
 */
function Connecting({ waking }: { waking: boolean }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-card bg-surface shadow-card">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
        <h2 className="text-lg font-semibold">Connecting to your pod</h2>
        <p className="mt-2 text-sm text-ink-2">
          {waking
            ? 'If it was asleep this takes a moment — it has to be scheduled and start up.'
            : 'Minting a connection token…'}
        </p>
      </div>
    </div>
  )
}

/** The pods on the account. One list, and the self-hosted ones join it at L2 —
 *  to the person reading it they are the same object, and `AppState` agrees. */
function PodsCard({
  pods,
  activeSlug,
  onConnect,
  onRefresh,
}: {
  pods: { id: string; slug: string; status?: string | null }[]
  activeSlug?: string
  onConnect: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">On your account</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            {pods.length === 0
              ? 'No pod on this account yet.'
              : 'Hosted, backed up, and woken on demand.'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh}>
          Check again
        </Button>
      </header>

      {pods.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {pods.map((p) => {
            const active = p.slug === activeSlug
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onConnect(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-chip px-3 py-2 text-left text-[12.5px]',
                    active ? 'bg-accent-tint' : 'bg-inset hover:bg-field',
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{p.slug || p.id}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                    {active ? 'connected' : (p.status ?? 'ready')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * Where the upgrade hand-off will live (LAUNCHPAD_PLAN §3.3, L4).
 *
 * Unverified, and deliberately in one place so L4 has one line to fix: nothing
 * in metalcraft-id returns a checkout URL today (LAUNCHPAD_PLAN §6.14), so this
 * is a guess at the website's own page rather than something the account service
 * told us.
 */
const UPGRADE_URL = 'https://metalcraftai.com/upgrade?from=desktop'

/**
 * The upsell — computed from state, not written as marketing.
 *
 * The two readers want opposite things. Someone without premium is being sold
 * something. Someone *with* premium and no pod has already bought it and is
 * looking at a provisioning problem; offering them an upgrade button would be
 * the app failing to notice it had already been paid.
 */
function GetAPodCard({ premium, hasPod }: { premium: boolean; hasPod: boolean }) {
  if (hasPod) return null

  if (premium) {
    return (
      <section className="rounded-card bg-surface p-5 shadow-card">
        <header className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold">Premium is on this account</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              But no pod is provisioned against it yet. That is not something this window can
              fix — if it does not appear shortly, the account page is the place to ask.
            </p>
          </div>
        </header>
        <Button
          size="sm"
          variant="outline"
          className="mt-4"
          onClick={() => window.open(UPGRADE_URL, '_blank')}
        >
          Open your account <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </section>
    )
  }

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Get a pod</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            A pod comes with Metalcraft premium — hosted and woken on demand, with no VPS to
            keep alive.
          </p>
        </div>
      </header>

      <ul className="mt-3 space-y-1 text-[12.5px] text-ink-2">
        <Perk>Thinking billed to your credits, so no provider key of your own</Perk>
        <Perk>WhatsApp and SMS, which need an account the pod can be linked to</Perk>
        <Perk>Registry identity for installing packs</Perk>
      </ul>

      <Button size="sm" className="mt-4" onClick={() => window.open(UPGRADE_URL, '_blank')}>
        Get Metalcraft premium <ExternalLink className="h-3.5 w-3.5" />
      </Button>
      <p className="mt-3 text-[11px] text-ink-3">
        Opens in your browser. Come back here when it is done — this list re-checks itself.
      </p>
    </section>
  )
}

function Perk({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-green" />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
