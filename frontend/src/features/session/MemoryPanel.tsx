import { useEffect } from "react";
import { useMemory } from "@/stores/memory";
import { Empty, Row, Section } from "@/components/ui/Facts";
import { relative } from "@/features/fleet/FleetView";
import { cn } from "@/lib/cn";
import type { DreamReport, MemorySystemStatus } from "@/types";

/**
 * The Memory mode (HARNESS_UI_PLAN H3).
 *
 * This was a tab in the right rail, a column ~360px wide, showing an agent's
 * whole recollection through a slot. The content never fitted it: memory samples
 * are sentences and the dream report is a paragraph, and both were being read
 * four words at a time.
 */
export function MemoryPanel({ instanceId }: { instanceId: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto w-full max-w-3xl">
        <Knows instanceId={instanceId} />
      </div>
    </div>
  );
}

/**
 * What this agent knows.
 *
 * The shipped/learned split leads because it is the distinction that matters:
 * memories its pack gave it are the vendor's claims, memories it formed are its
 * own, and conflating them would make an agent look like it worked something out
 * when it was simply told. `forgotten` counts shipped memories it has been told
 * to drop, which is why the numbers need not add up to the sample length.
 */
function Knows({ instanceId }: { instanceId: string }) {
  const view = useMemory((s) => s.byInstance[instanceId]);
  const loading = useMemory((s) => s.loading[instanceId]);
  const error = useMemory((s) => s.error[instanceId]);
  const load = useMemory((s) => s.load);

  // Lazily, and only while this tab is the one being looked at.
  useEffect(() => {
    if (!view) void load(instanceId);
  }, [instanceId, load, view]);

  if (error) return <Empty text={error} />;
  if (!view) return <Empty text={loading ? "Reading memory…" : ""} />;

  return (
    <>
      {/* The fact rows keep a narrow measure of their own inside this wide pane.
          `Row` puts the label and the value at opposite ends, which is right in
          a 360px rail and absurd at 800px — "Learned" and "4" a hand's width
          apart, with nothing between them to carry the eye across. The prose
          below is not constrained the same way: sentences want the full width. */}
      <div className="max-w-sm">
        <Section title="Knows">
          <Row label="Learned" value={view.learned} />
          <Row label="Shipped" value={view.shipped} />
          {view.forgotten > 0 && <Row label="Forgotten" value={view.forgotten} />}
          <Row label="Base" value={view.base} mono />
        </Section>

        <Dreaming instanceId={instanceId} system={view.system} />
      </div>

      {view.sample.length === 0 ? (
        <Empty text="This agent has not formed any memories yet." />
      ) : (
        <ul className="pt-3">
          {view.sample.map((m) => (
            <li key={m.id} className="border-b border-line py-2 last:border-0">
              <p className="text-[12px] leading-relaxed text-ink-2">{m.text}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                <span
                  className={cn(
                    "rounded-chip px-1 py-px",
                    m.origin === "learned" ? "bg-accent-tint text-accent" : "bg-inset",
                  )}
                >
                  {m.origin}
                </span>
                {m.entity && <span className="truncate font-mono">{m.entity}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * How memory is actually maintained, and when it last was.
 *
 * The counts above are a result; this is the machine behind them. Both belong in
 * one pane because the question they answer together is the one people ask of a
 * quiet agent: has it not learned anything, or has it not been *given the chance*
 * to? A queue of eighty captures with no dream in a week is the second, and it is
 * invisible without this.
 *
 * The whole block hides on a pod too old to report it, rather than rendering a
 * row of zeros that would read as a broken memory system rather than an older one.
 */
function Dreaming({
  instanceId,
  system,
}: {
  instanceId: string;
  system?: MemorySystemStatus | null;
}) {
  const dreaming = useMemory((s) => s.dreaming[instanceId]);
  const report = useMemory((s) => s.lastDream[instanceId]);
  const dream = useMemory((s) => s.dream);
  if (!system) return null;

  const { dream: d } = system;
  const next = d.next_run_at ? until(d.next_run_at) : null;
  const last = d.last_run_at ? relative(d.last_run_at) : null;

  return (
    <Section title="Dreaming">
      <p className="pb-2 text-[11.5px] leading-relaxed text-ink-3">
        Conversations are captured as they happen and distilled overnight into durable memories —
        merged, linked, and faded when unused.
      </p>
      <Row label="Nightly" value={d.nightly_enabled ? (next ? `due ${next}` : "on") : "off"} />
      <Row
        label="Last run"
        value={last ? `${last}${d.last_trigger === "manual" ? " (manual)" : ""}` : "never"}
      />
      {d.last_summary && (
        <p className="py-1 text-[11.5px] leading-relaxed text-ink-2">{d.last_summary}</p>
      )}
      {d.last_error && (
        <p className="py-1 text-[11.5px] leading-relaxed text-danger">{d.last_error}</p>
      )}
      <Row label="Waiting to distil" value={system.pending_captures} />
      <Row label="Connections" value={system.links} />
      {system.archived > 0 && <Row label="Faded" value={system.archived} />}
      {system.superseded > 0 && <Row label="Merged away" value={system.superseded} />}
      <Row label="Model" value={d.model} mono />
      {!system.capture_enabled && <Row label="Capture" value="off" />}

      {system.by_kind.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-2">
          {system.by_kind.map((k) => (
            <span
              key={k.kind}
              className="rounded-chip bg-inset px-1.5 py-px text-[10.5px] text-ink-3"
            >
              {k.count} {k.kind}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void dream(instanceId)}
        disabled={dreaming || !system.enabled}
        className={cn(
          "mt-3 w-full rounded-chip border border-line px-2 py-1.5 text-[11.5px] transition-colors duration-150",
          dreaming ? "text-ink-3" : "text-ink-2 hover:bg-hover hover:text-ink",
        )}
      >
        {dreaming ? "Dreaming…" : "Dream now"}
      </button>
      {dreaming && (
        // Said before it is felt: this is several model calls, and a button that
        // sits dead for two minutes with no explanation reads as a hang.
        <p className="pt-1 text-[10.5px] leading-relaxed text-ink-3">
          Distilling recent conversations. This takes a while — you can keep working.
        </p>
      )}
      {report && !dreaming && (
        <p className="pt-1 text-[10.5px] leading-relaxed text-ink-3">
          {report.error ?? `Done: ${dreamSummary(report)}.`}
        </p>
      )}
    </Section>
  );
}

/**
 * How long until an instant in the future — the mirror of `relative`, which
 * clamps to zero and so reports every future time as "just now".
 *
 * Rounded to the hour past a day, because the only future instant shown here is
 * a nightly schedule and "in 14 hours" is the useful precision. An instant that
 * has already passed reads as "now": the loop ticks once a minute, so a due time
 * a few seconds old means it is about to run, not that it was missed.
 */
function until(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = (then - Date.now()) / 1000;
  if (secs <= 60) return "now";
  if (secs < 3600) return `in ${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `in ${Math.round(secs / 3600)}h`;
  return `in ${Math.round(secs / 86_400)}d`;
}

/** What a finished run did, in the pane's voice rather than the pod's. */
function dreamSummary(report: DreamReport): string {
  const drained = report.captures_pending_before - report.captures_pending_after;
  const gained = report.memories_after - report.memories_before;
  if (drained === 0 && gained === 0) return "nothing new to distil";
  const parts: string[] = [];
  if (drained > 0) parts.push(`${drained} conversation turn(s) distilled`);
  if (gained > 0) parts.push(`${gained} memories added`);
  else if (gained < 0) parts.push(`${-gained} merged or faded`);
  return parts.join(", ");
}
