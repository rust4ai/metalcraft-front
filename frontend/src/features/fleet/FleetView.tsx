import { useEffect } from 'react'
import { Bot, Plus, RefreshCw, AlertTriangle } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import type { AgentInstance, InstanceOrigin } from '@/types'

/** PLAN §10.1 — the home screen: every agent on the pod, at a glance. */
export function FleetView() {
  const { instances, presets, status, loading, error, load } = useFleet()

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Fleet</h1>
          <p className="text-sm text-ink-dim">
            {instances.length} agent{instances.length === 1 ? '' : 's'} on this pod
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
          <Button size="sm" disabled={presets.length === 0}>
            <Plus className="h-4 w-4" />
            New agent
          </Button>
        </div>
      </header>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {instances.length === 0 && !loading ? (
        <EmptyFleet presetCount={presets.length} />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
          {instances.map((i) => (
            <InstanceCard key={i.id} instance={i} status={status[i.id] ?? 'idle'} />
          ))}
        </div>
      )}
    </div>
  )
}

function InstanceCard({
  instance,
  status,
}: {
  instance: AgentInstance
  status: Parameters<typeof StatusDot>[0]['status']
}) {
  return (
    <Card className="cursor-pointer">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <span className="truncate font-medium">{instance.name}</span>
          </div>
          <p className="mt-1 truncate text-xs text-ink-dim">
            {instance.agent_preset} · {instance.persona}
          </p>
        </div>
        <OriginBadge origin={instance.origin} />
      </div>

      {/* Reported, not hidden: the pack that provided this agent withdrew its
          preset, or an update changed its voice. Both are things the user did
          not ask for and should hear about. */}
      {instance.orphaned_from && (
        <Notice text={`${instance.orphaned_from} no longer provides this agent — running on a frozen copy`} />
      )}
      {instance.persona_fallback_from && (
        <Notice text={`persona ${instance.persona_fallback_from} was withdrawn; fell back to the preset default`} />
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-ink-faint">
        <span>{instance.persistent ? 'persistent' : 'ephemeral'}</span>
        <span>{relative(instance.last_active_at || instance.created_at)}</span>
      </div>
    </Card>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="mt-3 flex gap-2 rounded-lg border border-thinking/30 bg-thinking/10 px-2.5 py-2 text-xs text-ink-dim">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-thinking" />
      <span>{text}</span>
    </div>
  )
}

function OriginBadge({ origin }: { origin: InstanceOrigin }) {
  const label =
    origin.kind === 'gateway' ? origin.channel : origin.kind === 'flow' ? 'flow' : origin.kind
  return (
    <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
      {label}
    </span>
  )
}

function EmptyFleet({ presetCount }: { presetCount: number }) {
  return (
    <div className="grid place-items-center rounded-card border border-dashed border-line py-20 text-center">
      <Bot className="mb-3 h-8 w-8 text-ink-faint" />
      <p className="font-medium">No agents yet</p>
      <p className="mt-1 max-w-sm text-sm text-ink-dim">
        {presetCount === 0
          ? 'Install an agent pack to get a preset to spawn from.'
          : 'Spawn one from a preset to start a conversation.'}
      </p>
    </div>
  )
}

export function relative(iso: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, (Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}
