import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { routes } from "@/app/lib/routes";
import type { HeartbeatAction, HeartbeatSpec } from "@/app/types/api";
import { HeartbeatForm } from "./HeartbeatForm";
import { CalendarPreview } from "./CalendarPreview";
import { useHeartbeats } from "./queries";

const time = (ms: number) => new Date(ms).toLocaleString();

/** Signal colour only where a schedule's state means something. */
const STATE_DOT: Record<string, string> = {
  active: "bg-[var(--f-green)]",
  running: "bg-[var(--f-ink)] status-dot-pulse",
  paused: "border border-[var(--f-ink-4)]",
  suspended: "bg-[var(--f-amber)]",
  failed: "bg-[var(--f-red)]",
};

function StateDot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block size-1.5 shrink-0 rounded-pill",
        STATE_DOT[state] ?? "bg-[var(--f-ink-5)]",
      )}
    />
  );
}

/** One schedule in the list: a quiet row with its state and when it runs next. */
function ScheduleRow({
  name,
  state,
  meta,
  active = false,
  title,
  onClick,
}: {
  name: string;
  state: string;
  meta: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 text-left max-md:min-h-12",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
        active ? "bg-[var(--f-wash-2)]" : "hover:bg-[var(--f-wash-1)]",
      )}
    >
      <span className="mt-[7px]">
        <StateDot state={state} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-label text-basic-primary">{name}</span>
        <span className="truncate type-meta text-basic-tertiary">{meta}</span>
      </span>
    </button>
  );
}

/** A schedule that lives elsewhere: the row leads to it instead of opening it here. */
function ElsewhereRow({
  to,
  name,
  state,
  where,
}: {
  to: string;
  name: string;
  state: string;
  where: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 max-md:min-h-12",
        "transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)]",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
      )}
    >
      <span className="mt-[7px]">
        <StateDot state={state} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-label text-basic-secondary">
          {name} · {state} · {where}
        </span>
      </span>
      <Icon iconName={IconName.External} size={14} className="mt-1 shrink-0 text-basic-muted" />
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-meta text-basic-tertiary">{label}</dt>
      <dd className="min-w-0 type-body-chrome text-basic-primary break-words">{children}</dd>
    </>
  );
}

export function HeartbeatPanel({ sessionId }: { sessionId: string }) {
  return <SessionHeartbeats key={sessionId} sessionId={sessionId} />;
}

function SessionHeartbeats({ sessionId }: { sessionId: string }) {
  const [allChats, setAllChats] = useState(false);
  const [search, setSearch] = useSearchParams();
  const selected = search.get("heartbeat");
  const occurrence = search.get("occurrence");
  const body = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  const setSelected = (id: string) => {
    const next = new URLSearchParams(search);
    next.set("heartbeat", id);
    next.delete("occurrence");
    setSearch(next);
  };
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const { showSidePanelList } = useNativeRuntime().stores.sessionLayoutStore;
  const heartbeat = useHeartbeats(sessionId, selected, allChats);
  const schedule = heartbeat.inspection.data?.schedule;
  useEffect(() => {
    if (!occurrence || focused.current === occurrence) return;
    const target = body.current?.querySelector<HTMLElement>(
      `[data-occurrence="${CSS.escape(occurrence)}"]`,
    );
    if (target) {
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
      focused.current = occurrence;
    }
  }, [occurrence, heartbeat.inspection.data]);
  const busy = heartbeat.control.isPending || heartbeat.intent !== null;
  const editable = schedule && !["deleted", "finished", "stopped"].includes(schedule.state);
  const choose = (id: string) => {
    setSelected(id);
    setForm(null);
    showSidePanelList(false);
  };
  const openCreate = () => {
    setForm("create");
    showSidePanelList(false);
  };
  const act = (action: "pause" | "resume" | "stop" | "delete" | "run_now") => {
    if (schedule)
      heartbeat.submit({
        action,
        schedule_id: schedule.schedule_id,
        expected_version: schedule.version,
      } as HeartbeatAction);
  };
  const save = (spec: HeartbeatSpec) => {
    heartbeat.submit(
      form === "edit" && schedule
        ? {
            action: "edit",
            schedule_id: schedule.schedule_id,
            expected_version: editingVersion ?? schedule.version,
            spec,
          }
        : { action: "create", spec },
      (receipt) => {
        setForm(null);
        setSelected(receipt.schedule.schedule_id);
      },
    );
  };
  const receipt = heartbeat.control.data;
  const isMobile = useIsMobile();
  return (
    <PanelSplit
      listTitle="Heartbeats"
      title={form === "create" ? "New heartbeat" : (schedule?.spec.name ?? "Heartbeats")}
      listToolbar={
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            isMobile ? "flex-1" : "shrink-0 border-b border-tertiary px-2 py-2",
          )}
        >
          <Button
            size={isMobile ? ButtonSize.Large : ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            content={ButtonContent.IconLeft}
            onClick={openCreate}
            disabled={busy}
          >
            <Icon iconName={IconName.Add} />
            New heartbeat
          </Button>
          <span className="flex-1" />
          <Button
            size={isMobile ? ButtonSize.Large : ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={() => setAllChats(!allChats)}
          >
            {allChats ? "This chat" : "All chats"}
          </Button>
        </div>
      }
      list={
        <div className="flex flex-col gap-0.5">
          {heartbeat.inventory.isPending ? (
            <p role="status" className="px-2.5 py-2 type-meta text-basic-tertiary">
              Loading heartbeats…
            </p>
          ) : null}
          {heartbeat.inventory.error ? (
            <p role="alert" className="px-2.5 py-2 type-meta text-error-primary">
              {heartbeat.inventory.error.message}
            </p>
          ) : null}
          {heartbeat.inventory.data?.map((item) =>
            item.session_id == null ? (
              <ElsewhereRow
                key={item.schedule_id}
                to={`${routes.taskSchedules(item.binding.project_id ?? undefined)}?schedule=${encodeURIComponent(item.schedule_id)}`}
                name={item.spec.name}
                state={item.state}
                where="Open project schedule"
              />
            ) : item.session_id !== sessionId ? (
              <ElsewhereRow
                key={item.schedule_id}
                to={routes.session(item.session_id, "heartbeats")}
                name={item.spec.name}
                state={item.state}
                where="Open chat"
              />
            ) : (
              <ScheduleRow
                key={item.schedule_id}
                name={item.spec.name}
                state={item.state}
                meta={
                  item.state === "active"
                    ? `Next ${item.spec.calendar ? new Date(item.next_due_ms).toLocaleString() : time(item.next_due_ms)}`
                    : item.state
                }
                title={`${item.state} · next ${item.spec.calendar ? `${new Date(item.next_due_ms).toISOString()} · ${item.spec.calendar.zone}` : time(item.next_due_ms)}`}
                active={selected === item.schedule_id}
                onClick={() => choose(item.schedule_id)}
              />
            ),
          )}
          {heartbeat.inventory.data?.length === 0 ? (
            <p className="px-2.5 py-2 type-meta text-basic-tertiary">No heartbeats in this chat.</p>
          ) : null}
        </div>
      }
    >
      <div
        ref={body}
        className="flex-1 min-h-0 overflow-auto px-5 py-5 pt-18 md:pt-5 flex flex-col gap-5 type-body-chrome text-basic-primary"
      >
        {heartbeat.error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-card border border-[var(--f-red-line)] bg-error-primary px-4 py-3"
          >
            <p className="text-error-primary">{heartbeat.error.message}</p>
            {heartbeat.intent ? (
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={heartbeat.control.isPending}
                onClick={heartbeat.retry}
              >
                Retry same request
              </Button>
            ) : null}
            {heartbeat.rejected ? (
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                onClick={() => {
                  heartbeat.dismissRejection();
                  setForm(null);
                }}
              >
                Review latest schedule
              </Button>
            ) : null}
            <p className="type-meta text-basic-tertiary">
              Retry uses the saved request identity. A version conflict requires reviewing the
              latest schedule.
            </p>
          </div>
        ) : null}
        {receipt ? (
          <p role="status" className="type-meta text-basic-tertiary">
            {receipt.schedule.spec.name}: {receipt.schedule.state}.
            {receipt.active_occurrence
              ? " An admitted check is still active; its final result will appear below."
              : ""}
          </p>
        ) : null}
        {selected && heartbeat.inspection.isPending ? (
          <p role="status" className="type-meta text-basic-tertiary">
            Loading heartbeat…
          </p>
        ) : null}
        {heartbeat.inspection.error ? (
          <p role="alert" className="text-error-primary">
            {heartbeat.inspection.error.message}
          </p>
        ) : null}
        {form ? (
          <HeartbeatForm
            sessionId={sessionId}
            key={`${form}:${selected}`}
            initial={form === "edit" ? schedule?.spec : undefined}
            disabled={busy}
            onSubmit={save}
            onCancel={() => setForm(null)}
          />
        ) : schedule ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="type-heading text-basic-primary break-words">{schedule.spec.name}</h2>
              <p className="flex items-center gap-2 type-meta text-basic-tertiary">
                <StateDot state={schedule.state} />
                <span>
                  {schedule.state}
                  {schedule.reason ? ` · ${schedule.reason}` : ""}
                </span>
              </p>
            </div>
            <p className="whitespace-pre-wrap rounded-card border border-tertiary bg-elevation-level-1 px-4 py-3 text-basic-secondary">
              {schedule.spec.instructions}
            </p>
            <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 items-baseline">
              <Fact label="Cadence">
                {schedule.spec.calendar
                  ? `${schedule.spec.calendar.days.kind} · ${String(schedule.spec.calendar.hour).padStart(2, "0")}:${String(schedule.spec.calendar.minute).padStart(2, "0")} · ${schedule.spec.calendar.zone}`
                  : `${(schedule.spec.interval_ms ?? 0) / 60000} minutes`}
              </Fact>
              <Fact label="Next check">
                {schedule.state === "active" ? (
                  schedule.spec.calendar ? (
                    <>
                      <span>
                        {heartbeat.inspection.data?.calendar_preview?.next_due?.local.replace(
                          "T",
                          " ",
                        ) ?? "Local time loading"}{" "}
                        · {schedule.spec.calendar.zone}
                      </span>
                      <br />
                      <span className="type-meta text-basic-muted">
                        UTC {new Date(schedule.next_due_ms).toISOString()}
                      </span>
                    </>
                  ) : (
                    time(schedule.next_due_ms)
                  )
                ) : (
                  "Not scheduled"
                )}
              </Fact>
              <Fact label="Finish condition">{schedule.spec.end_condition}</Fact>
              <Fact label="Skills">{schedule.spec.skills?.join(", ") || "None"}</Fact>
              <Fact label="Checks started">
                <span className="tabular">
                  {schedule.starts} / {schedule.spec.max_occurrences}
                </span>
              </Fact>
              <Fact label="Tokens used">
                {schedule.tokens_used}
                {schedule.spec.token_allowance ? ` / ${schedule.spec.token_allowance}` : ""}
                {schedule.usage_unknown ? " · some usage unknown" : ""}
              </Fact>
              <Fact label="Execution time">
                {(schedule.time_used_ms / 1000).toFixed(1)} seconds
              </Fact>
              <Fact label="Deadline per check">
                {schedule.spec.execution_timeout_ms == null
                  ? "Unknown"
                  : `${schedule.spec.execution_timeout_ms / 1000} seconds`}
              </Fact>
              <Fact label="Goal">{schedule.spec.goal_id || "Ordinary check"}</Fact>
            </dl>
            {heartbeat.inspection.data?.calendar_preview ? (
              <CalendarPreview preview={heartbeat.inspection.data.calendar_preview} />
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={busy || !editable}
                onClick={() => {
                  setEditingVersion(schedule.version);
                  setForm("edit");
                }}
              >
                Edit
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={busy || schedule.state !== "active"}
                onClick={() => act("run_now")}
              >
                Run now
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={busy || schedule.state !== "active"}
                onClick={() => act("pause")}
              >
                Pause
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={busy || !["paused", "suspended"].includes(schedule.state)}
                onClick={() => act("resume")}
              >
                Resume
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={busy || !editable}
                onClick={() => act("stop")}
              >
                Stop
              </Button>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.GhostDestructive}
                disabled={busy || schedule.state === "deleted"}
                onClick={() => act("delete")}
              >
                Delete
              </Button>
            </div>
            <p className="-mt-2 type-meta text-basic-tertiary">
              Delete removes future checks. An admitted check continues unless stopped. Paused
              checks do not catch up when resumed.
            </p>
            <h3 className="pt-1 type-strong text-basic-primary">Recent checks</h3>
            {heartbeat.inspection.data?.history.map((item) => (
              <article
                key={item.occurrence_id}
                data-occurrence={item.occurrence_id}
                tabIndex={-1}
                className="flex flex-col gap-1 rounded-card border border-tertiary px-4 py-3 outline-[var(--color-border-focus-outline)] focus:outline-2"
              >
                <p className="type-meta-strong text-basic-secondary">
                  {item.outcome ?? item.state} ·{" "}
                  {item.run_now ? "Run now" : time(item.due_first_ms)}
                  {item.coalesced_count > 1
                    ? ` · ${item.coalesced_count} checks coalesced through ${time(item.due_last_ms)}`
                    : ""}
                </p>
                <p className="whitespace-pre-wrap text-basic-primary">{item.evidence}</p>
                {item.run_id ? (
                  <Link
                    className="self-start type-meta text-info-primary hover:underline"
                    to={`${routes.session(sessionId, "heartbeats")}?heartbeat=${encodeURIComponent(item.schedule_id)}&occurrence=${encodeURIComponent(item.occurrence_id)}`}
                    title={item.run_id}
                  >
                    Run {item.run_id}
                  </Link>
                ) : null}
                <p className="type-meta tabular text-basic-muted">
                  {item.tokens_used === null
                    ? "Usage pending or unknown"
                    : `${item.tokens_used} tokens`}
                </p>
              </article>
            ))}
          </>
        ) : selected && (heartbeat.inspection.isPending || heartbeat.inspection.error) ? null : (
          <p className="m-auto max-w-80 py-10 text-center type-body-chrome text-basic-tertiary">
            Choose a heartbeat or create a recurring check for this chat. Checks run while the
            server is running, including after you close this page.
          </p>
        )}
      </div>
    </PanelSplit>
  );
}
