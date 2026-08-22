import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { StatusDot } from '@/components/ui/StatusDot'

/**
 * The bottom bar (UI_PLAN §2, S5 — this is the S1 subset).
 *
 * It exists now because deleting the title bar left the pod and the account
 * without a home. Orca's usage meters are deliberately absent: `rpc/index.ts`
 * reports no credit balance, and a mocked percentage in the one place a person
 * checks what they have spent is the wrong kind of placeholder.
 */
export function StatusBar() {
  const { session, info, pod } = useConnection()
  const live = useFleet((s) => Object.values(s.status).filter((v) => v === 'thinking' || v === 'running').length)

  return (
    <footer className="col-span-full flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-canvas px-3 text-[11px] text-ink-3">
      {info && <StatusDot status="idle" />}
      {pod && <span className="font-mono">{pod.slug}</span>}
      {info?.version && <span className="font-mono">v{info.version}</span>}
      {live > 0 && (
        <span className="tnum text-accent">
          {live} working
        </span>
      )}
      <span className="ml-auto">{session?.email}</span>
    </footer>
  )
}
