import { useEffect, useMemo } from 'react'
import { KeyRound, MessageCircle, Plus, Store, X } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { useNudges } from '@/stores/nudges'
import { canThink, useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'

interface Nudge {
  key: string
  icon: typeof KeyRound
  title: string
  body: string
  action: string
  run: () => void
}

/**
 * Orca's bottom-left setup card (UI_PLAN §2, S6).
 *
 * These are the optional steps of PLAN §9 — the ones that make the app
 * *interesting* rather than merely functional — moved out of the onboarding
 * corridor. A pod that already works should not be marched through a wizard to
 * discover it can install packs; it should be told, once, in the corner, and be
 * able to wave it away.
 *
 * **One card, not a stack.** The spec said stack; a queue of setup nags in the
 * corner of a working app is noise, and the second-most-urgent thing can wait
 * until the first is handled or dismissed.
 *
 * Nothing here nudges toward Octaweave (PLAN §9.3 / P7): it is optional, and the
 * connection is one button in Settings — a nudge would be pushing an add-on, not
 * clearing a blocker, which is the only thing this strip is for.
 */
export function Nudges() {
  const info = useConnection((s) => s.info)
  const session = useConnection((s) => s.session)
  const premium = useConnection((s) => s.session?.premium ?? false)
  const pods = useConnection((s) => s.pods)
  const podsLoaded = useConnection((s) => s.podsLoaded)
  const pod = useConnection((s) => s.pod)
  const { instances, presets, loading } = useFleet()
  const { ownSource, inference, go, setNewAgentOpen } = useUi()
  const { dismissed, dismiss, revive } = useNudges()

  const applicable = useMemo<Nudge[]>(() => {
    const out: Nudge[] = []
    // Never on an empty key store alone: a provisioned pod thinks on an injected
    // credential that never appears there (see `canThink`).
    if (canThink({ inference, ownSource }, premium) === false) {
      out.push({
        key: 'source',
        icon: KeyRound,
        title: 'This pod cannot think yet',
        // Two ways to get here, and they want different things done about them.
        body: inference?.ready
          ? 'Its thinking bills to Metalcraft credits, which needs premium on this account. Until then, give it a provider key of its own.'
          : 'It has no provider credential at all, so a turn has nothing to authenticate with.',
        action: 'Bind a source',
        run: () => go({ kind: 'source' }),
      })
    }
    if (presets.length === 0) {
      out.push({
        key: 'no-presets',
        icon: Store,
        title: 'No agents to spawn from',
        body: 'Agent packs bring the presets and personas you spawn instances from. Axoniac Prime is the default host.',
        action: 'Browse extensions',
        run: () => go({ kind: 'packs' }),
      })
    } else if (instances.length === 0) {
      out.push({
        key: 'no-instances',
        icon: Plus,
        title: 'Spawn your first agent',
        body: `You have ${presets.length} preset${presets.length === 1 ? '' : 's'} installed. An instance is one agent with its own memory and conversations.`,
        action: 'New agent',
        run: () => setNewAgentOpen(true),
      })
    }

    // The self-hoster (LAUNCHPAD_PLAN §3.3). Last on purpose: it is the only
    // entry here that sells rather than unblocks, so it speaks only when nothing
    // else needs doing, and it is dismissible like the rest.
    //
    // This is the reader a paywall insults — they run the product daily, on
    // their own hardware, and are the least likely of anyone to be moved by a
    // page of benefits. So the pitch is two things that are specific and
    // checkable *for them*, both of which they can verify from inside this app:
    // the gateway card already refuses on a pod with no Metalcraft account, in
    // those words, and their thinking is billed to a provider key they pay for
    // themselves. It points at the Launchpad rather than restating the offer,
    // because the price lives there and is quoted by the hub.
    // `podsLoaded`, not `ready`: the window is ready the moment it knows who you
    // are, which is *before* it knows what you own — and in that window `pods` is
    // an empty array that means nothing. Signed out there is no list to wait for
    // and never will be, which is itself the answer.
    const knowWhatTheAccountOwns = !session || podsLoaded
    if (knowWhatTheAccountOwns && pod && !premium && !pods.some((p) => p.slug === pod.slug)) {
      out.push({
        key: 'self-hosted-premium',
        icon: MessageCircle,
        title: 'Premium adds two things to this pod',
        body: 'WhatsApp and SMS need an account the pod can be linked to, and credits mean its thinking is not billed to a provider key of your own. Your pod stays yours either way.',
        action: 'See what it costs',
        run: () => go({ kind: 'pods' }),
      })
    }
    return out
  }, [
    go,
    inference,
    instances.length,
    ownSource,
    pod,
    pods,
    podsLoaded,
    premium,
    presets.length,
    session,
    setNewAgentOpen,
  ])

  // A dismissal only lasts as long as the thing it dismissed. Once a condition
  // resolves, forget that it was waved away, so it can speak again if it recurs.
  useEffect(() => {
    const live = new Set(applicable.map((n) => n.key))
    for (const key of dismissed) if (!live.has(key)) revive(key)
  }, [applicable, dismissed, revive])

  // Never while the fleet is still loading: every condition here is "you have
  // none of X", and an empty list mid-fetch is indistinguishable from an empty
  // pod. Nudging on that would flash a wrong card on every launch.
  if (!info || loading) return null

  const nudge = applicable.find((n) => !dismissed.includes(n.key))
  if (!nudge) return null

  return (
    // Inside the sidebar column, not floating over the window. The first version
    // was `absolute bottom-10 left-4` on the *shell*, which put a 320px card on
    // top of the session composer — the text box was still there and still
    // focusable, just underneath a card, which reads exactly like "there is no
    // input box". Bounded by the sidebar, it cannot reach the centre pane at all.
    <div className="animate-fade-up absolute inset-x-2 bottom-11 z-30 rounded-card bg-surface p-4 shadow-overlay">
      <div className="flex items-start gap-2">
        <nudge.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <h2 className="flex-1 text-[13.5px] font-semibold">{nudge.title}</h2>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(nudge.key)}
          className="rounded-chip p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{nudge.body}</p>
      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={nudge.run}>
        {nudge.action}
      </Button>
    </div>
  )
}
