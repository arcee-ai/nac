import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ButtonVariant } from "@/app/atoms";
import { PanelRow, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { routes } from "@/app/lib/routes";
import type { HeartbeatAction, HeartbeatSpec } from "@/app/types/api";
import { HeartbeatForm } from "./HeartbeatForm";
import { useHeartbeats } from "./queries";

const time = (ms: number) => new Date(ms).toLocaleString();

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
  return (
    <PanelSplit
      listTitle="Heartbeats"
      title={form === "create" ? "New heartbeat" : (schedule?.spec.name ?? "Heartbeats")}
      listToolbar={
        <>
          <Button onClick={() => setAllChats(!allChats)}>
            {allChats ? "This chat" : "All chats"}
          </Button>
          <Button onClick={openCreate} disabled={busy}>
            New heartbeat
          </Button>
        </>
      }
      list={
        <>
          {heartbeat.inventory.isPending ? <p role="status">Loading heartbeats…</p> : null}
          {heartbeat.inventory.error ? (
            <p role="alert">{heartbeat.inventory.error.message}</p>
          ) : null}
          {heartbeat.inventory.data?.map((item) =>
            item.session_id !== sessionId ? (
              <Link
                key={item.schedule_id}
                to={routes.session(item.session_id, "heartbeats")}
                className="block p-2"
              >
                {item.spec.name} · {item.state} · Open chat
              </Link>
            ) : (
              <PanelRow
                key={item.schedule_id}
                label={item.spec.name}
                title={`${item.state} · next ${time(item.next_due_ms)}`}
                active={selected === item.schedule_id}
                onClick={() => choose(item.schedule_id)}
                trailing={<span className="text-basic-muted">{item.state}</span>}
              />
            ),
          )}
          {heartbeat.inventory.data?.length === 0 ? (
            <p className="p-2 text-basic-muted">No heartbeats in this chat.</p>
          ) : null}
        </>
      }
    >
      <div
        ref={body}
        className="flex-1 min-h-0 overflow-auto p-4 pt-18 md:pt-4 flex flex-col gap-4 text-small"
      >
        {heartbeat.error ? (
          <div role="alert">
            <p>{heartbeat.error.message}</p>
            {heartbeat.intent ? (
              <Button disabled={heartbeat.control.isPending} onClick={heartbeat.retry}>
                Retry same request
              </Button>
            ) : null}
            {heartbeat.rejected ? (
              <Button
                onClick={() => {
                  heartbeat.dismissRejection();
                  setForm(null);
                }}
              >
                Review latest schedule
              </Button>
            ) : null}
            <p>
              Retry uses the saved request identity. A version conflict requires reviewing the
              latest schedule.
            </p>
          </div>
        ) : null}
        {receipt ? (
          <p role="status">
            {receipt.schedule.spec.name}: {receipt.schedule.state}.
            {receipt.active_occurrence
              ? " An admitted check is still active; its final result will appear below."
              : ""}
          </p>
        ) : null}
        {form ? (
          <HeartbeatForm
            key={`${form}:${selected}`}
            initial={form === "edit" ? schedule?.spec : undefined}
            disabled={busy}
            onSubmit={save}
            onCancel={() => setForm(null)}
          />
        ) : schedule ? (
          <>
            <div>
              <h2 className="header-md">{schedule.spec.name}</h2>
              <p>
                {schedule.state}
                {schedule.reason ? ` · ${schedule.reason}` : ""}
              </p>
            </div>
            <p className="whitespace-pre-wrap">{schedule.spec.instructions}</p>
            <dl className="grid grid-cols-2 gap-2">
              <dt>Interval</dt>
              <dd>{schedule.spec.interval_ms / 60000} minutes</dd>
              <dt>Next check</dt>
              <dd>{schedule.state === "active" ? time(schedule.next_due_ms) : "Not scheduled"}</dd>
              <dt>Finish condition</dt>
              <dd>{schedule.spec.end_condition}</dd>
              <dt>Skills</dt>
              <dd>{schedule.spec.skills?.join(", ") || "None"}</dd>
              <dt>Checks started</dt>
              <dd>
                {schedule.starts} / {schedule.spec.max_occurrences}
              </dd>
              <dt>Tokens used</dt>
              <dd>
                {schedule.tokens_used}
                {schedule.spec.token_allowance ? ` / ${schedule.spec.token_allowance}` : ""}
                {schedule.usage_unknown ? " · some usage unknown" : ""}
              </dd>
              <dt>Execution time</dt>
              <dd>{(schedule.time_used_ms / 1000).toFixed(1)} seconds</dd>
              <dt>Deadline per check</dt>
              <dd>
                {schedule.spec.execution_timeout_ms == null
                  ? "Unknown"
                  : `${schedule.spec.execution_timeout_ms / 1000} seconds`}
              </dd>
              <dt>Goal</dt>
              <dd>{schedule.spec.goal_id || "Ordinary check"}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !editable}
                onClick={() => {
                  setEditingVersion(schedule.version);
                  setForm("edit");
                }}
              >
                Edit
              </Button>
              <Button disabled={busy || schedule.state !== "active"} onClick={() => act("run_now")}>
                Run now
              </Button>
              <Button disabled={busy || schedule.state !== "active"} onClick={() => act("pause")}>
                Pause
              </Button>
              <Button
                disabled={busy || !["paused", "suspended"].includes(schedule.state)}
                onClick={() => act("resume")}
              >
                Resume
              </Button>
              <Button disabled={busy || !editable} onClick={() => act("stop")}>
                Stop
              </Button>
              <Button
                variant={ButtonVariant.GhostDestructive}
                disabled={busy || schedule.state === "deleted"}
                onClick={() => act("delete")}
              >
                Delete
              </Button>
            </div>
            <p className="text-basic-muted">
              Delete removes future checks. An admitted check continues unless stopped. Paused
              checks do not catch up when resumed.
            </p>
            <h3 className="header-sm">Recent checks</h3>
            {heartbeat.inspection.data?.history.map((item) => (
              <article
                key={item.occurrence_id}
                data-occurrence={item.occurrence_id}
                tabIndex={-1}
                className="border-t border-muted pt-3 flex flex-col gap-1"
              >
                <p>
                  {item.outcome ?? item.state} ·{" "}
                  {item.run_now ? "Run now" : time(item.due_first_ms)}
                  {item.coalesced_count > 1
                    ? ` · ${item.coalesced_count} checks coalesced through ${time(item.due_last_ms)}`
                    : ""}
                </p>
                <p className="whitespace-pre-wrap">{item.evidence}</p>
                {item.run_id ? (
                  <Link
                    to={`${routes.session(sessionId, "heartbeats")}?heartbeat=${encodeURIComponent(item.schedule_id)}&occurrence=${encodeURIComponent(item.occurrence_id)}`}
                    title={item.run_id}
                  >
                    Run {item.run_id}
                  </Link>
                ) : null}
                <p className="text-basic-muted">
                  {item.tokens_used === null
                    ? "Usage pending or unknown"
                    : `${item.tokens_used} tokens`}
                </p>
              </article>
            ))}
            {heartbeat.inspection.error ? (
              <p role="alert">{heartbeat.inspection.error.message}</p>
            ) : null}
          </>
        ) : (
          <p className="text-basic-muted">
            Choose a heartbeat or create a recurring check for this chat. Checks run while the
            server is running, including after you close this page.
          </p>
        )}
      </div>
    </PanelSplit>
  );
}
