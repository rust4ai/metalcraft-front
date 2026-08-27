import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { BookOpen, Bot, Clock, KeyRound, LayoutGrid, PanelLeft, PanelRight, Plus, ScrollText, ServerCog, Settings, Sparkles, Store } from 'lucide-react'
import { useFleet, startablePresets } from '@/stores/fleet'
import { useLayout } from '@/stores/layout'
import { useUi } from '@/stores/ui'
import { StatusDot } from '@/components/ui/StatusDot'
import { tabLabel } from './TabStrip'

/**
 * `⌘K` (UI_PLAN §2, S7) — Orca's `▷ Command`.
 *
 * Ordered by what someone is most likely reaching for: the agent they want to
 * talk to, then the tab they left open, then spawning something new, then the
 * places. Presets sit *below* instances deliberately — "open Amy" is a hundred
 * times more common than "spawn a second Amy", and putting creation first is how
 * palettes end up spawning things by accident.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { instances, presets, status, spawn } = useFleet()
  const { tabs, activeKey, go, select, setNewAgentOpen } = useUi()
  const { toggleSidebar, toggleRail, sidebarOpen, railOpen } = useLayout()
  const [search, setSearch] = useState('')

  // A stale query is a stale result list; the next ⌘K should start clean.
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  const nameOf = (id: string) => instances.find((i) => i.id === id)?.name

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      shouldFilter
      // Radix under cmdk gives focus trap and escape; the overlay is ours.
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[18%] z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-card bg-surface shadow-overlay"
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search agents, tabs and actions…"
        className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] text-ink caret-accent outline-none placeholder:text-ink-3"
      />

      <Command.List className="max-h-[min(24rem,50vh)] overflow-y-auto p-2">
        <Command.Empty className="px-2 py-8 text-center text-[13px] text-ink-3">
          Nothing matches “{search}”.
        </Command.Empty>

        <Group heading="Agents">
          {instances.map((i) => (
            <Item
              key={i.id}
              // The preset is in the value, not just the label, so typing a pack
              // name finds every agent spawned from it.
              value={`agent ${i.name} ${i.agent_preset} ${i.persona}`}
              onSelect={() => run(() => go({ kind: 'session', instanceId: i.id }))}
              icon={<StatusDot status={status[i.id] ?? 'idle'} />}
              label={i.name}
              hint={i.agent_preset}
            />
          ))}
        </Group>

        {tabs.length > 1 && (
          <Group heading="Open tabs">
            {tabs
              .filter((t) => t.key !== activeKey)
              .map((t) => (
                <Item
                  key={t.key}
                  value={`tab ${tabLabel(t.view, nameOf)}`}
                  onSelect={() => run(() => select(t.key))}
                  icon={<LayoutGrid className="h-3.5 w-3.5" />}
                  label={tabLabel(t.view, nameOf)}
                />
              ))}
          </Group>
        )}

        <Group heading="Spawn">
          <Item
            value="new agent spawn create"
            onSelect={() => run(() => setNewAgentOpen(true))}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="New agent…"
            hint="⌘N"
          />
          {/* Libraries excluded: a pack's library preset is not something to be,
              and the pod answers 400 to anything that tries. */}
          {startablePresets(presets).map((p) => (
            <Item
              key={p.slug}
              value={`spawn ${p.name} ${p.slug}`}
              onSelect={() => run(() => void spawn(p.slug))}
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={`Spawn ${p.name}`}
              hint={p.slug}
            />
          ))}
        </Group>

        <Group heading="Go">
          <Item value="go home fleet agents" onSelect={() => run(() => go({ kind: 'fleet' }))} icon={<Bot className="h-3.5 w-3.5" />} label="Home" />
          {/* The old words stay in `value`, which is only ever matched against:
              somebody who learned this as "browse agent presets" must still find
              it by typing that. */}
          <Item value="go packs extensions browse agent presets registry axoniac" onSelect={() => run(() => go({ kind: 'packs' }))} icon={<Store className="h-3.5 w-3.5" />} label="Extensions" />
          <Item value="go library artifacts presets personas skills integrations tools installed" onSelect={() => run(() => go({ kind: 'library' }))} icon={<BookOpen className="h-3.5 w-3.5" />} label="Library" hint="what is on this pod" />
          <Item value="go automations flows schedules cron runs" onSelect={() => run(() => go({ kind: 'automations' }))} icon={<Clock className="h-3.5 w-3.5" />} label="Automations" />
          <Item value="go interface source key provider" onSelect={() => run(() => go({ kind: 'source' }))} icon={<KeyRound className="h-3.5 w-3.5" />} label="Interface source" />
          <Item value="go pods connect switch pod url self hosted vps premium" onSelect={() => run(() => go({ kind: 'pods' }))} icon={<ServerCog className="h-3.5 w-3.5" />} label="Pods" hint="connect · switch" />
          <Item value="go settings keys octaweave connection" onSelect={() => run(() => go({ kind: 'settings' }))} icon={<Settings className="h-3.5 w-3.5" />} label="Settings" hint="keys · Octaweave" />
          <Item value="go errors error log diagnostics failures problems why" onSelect={() => run(() => go({ kind: 'errors' }))} icon={<ScrollText className="h-3.5 w-3.5" />} label="Error log" hint="what failed" />
        </Group>

        <Group heading="View">
          <Item
            value="toggle sidebar"
            onSelect={() => run(toggleSidebar)}
            icon={<PanelLeft className="h-3.5 w-3.5" />}
            label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            hint="⌘B"
          />
          <Item
            value="toggle details rail"
            onSelect={() => run(toggleRail)}
            icon={<PanelRight className="h-3.5 w-3.5" />}
            label={railOpen ? 'Hide details' : 'Show details'}
            hint="⌘J"
          />
        </Group>
      </Command.List>
    </Command.Dialog>
  )
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3"
    >
      {children}
    </Command.Group>
  )
}

function Item({
  value,
  onSelect,
  icon,
  label,
  hint,
}: {
  value: string
  onSelect: () => void
  icon: React.ReactNode
  label: string
  hint?: string
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-[13px] text-ink data-[selected=true]:bg-hover-2"
    >
      <span className="flex w-4 shrink-0 justify-center text-ink-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{hint}</span>}
    </Command.Item>
  )
}
