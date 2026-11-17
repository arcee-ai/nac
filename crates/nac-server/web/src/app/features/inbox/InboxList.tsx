import { useRef, useState, type KeyboardEvent } from "react";
import { useLocation } from "react-router-dom";

import { Icon, IconName, StatusDot } from "@/app/atoms";
import { useNow } from "@/app/hooks/useNow";
import { cn } from "@/app/lib/cn";
import { sessionIdFromPath } from "@/app/lib/routes";
import type { SessionStatus } from "@/app/lib/sessionStatus";

import { compactAge } from "../sidebar/relativeTime";
import type { InboxRow } from "./inboxModel";
import { useInbox } from "./inboxContext";

function rowStatus(row: InboxRow): SessionStatus {
  if (row.group === "needs-you")
    return row.approvals > 0 || row.reviews > 0 ? "needs-approval" : "needs-answer";
  if (row.group === "failed") return "failed";
  if (row.group === "done") return "done";
  return "idle";
}

function Row({
  row,
  now,
  active,
  touch,
  onOpen,
}: {
  row: InboxRow;
  now: number;
  active: boolean;
  touch: boolean;
  onOpen: () => void;
}) {
  const age = compactAge(new Date(row.at).toISOString(), now);
  return (
    <li>
      <button
        type="button"
        data-inbox-row
        aria-current={active ? "page" : undefined}
        aria-label={`${row.title}, ${row.detail}`}
        title={row.title}
        onClick={onOpen}
        className={cn(
          "group/inbox flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 text-left outline-none",
          touch ? "min-h-14 py-2.5" : "min-h-11 py-2",
          "transition-colors duration-150 ease-out motion-reduce:transition-none",
          active ? "bg-[var(--f-wash-2)]" : "hover:bg-[var(--f-wash-1)]",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--f-focus)]",
        )}
      >
        <span className="flex h-5 w-3 shrink-0 items-center justify-center">
          <StatusDot status={rowStatus(row)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate type-body-chrome",
                touch && "!text-md",
                row.group === "unavailable" ? "text-basic-tertiary" : "text-basic-primary",
              )}
            >
              {row.title}
            </span>
            {age ? (
              <span className="type-meta tabular shrink-0 text-basic-muted">{age}</span>
            ) : null}
          </span>
          <span
            className={cn(
              "type-meta min-w-0 truncate",
              row.group === "needs-you"
                ? "text-[var(--f-amber-text)]"
                : row.group === "failed"
                  ? "text-[var(--f-red-text)]"
                  : "text-basic-tertiary",
            )}
          >
            {row.detail}
            {row.projectName ? (
              <span className="text-basic-muted"> · {row.projectName}</span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col">
      <div className="flex h-7 items-center gap-2 px-2.5">
        <h3 className="type-meta-strong text-basic-tertiary">{title}</h3>
        {count ? <span className="type-meta tabular text-basic-muted">{count}</span> : null}
        <span className="flex-1" />
        {action}
      </div>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

/**
 * The Inbox: what needs you (oldest first), then failed and finished work you
 * have not opened. Navigate only — decisions are made on the session's own
 * attention card, at the exact request. j/k move, Enter opens.
 */
export function InboxList({ touch = false, onOpened }: { touch?: boolean; onOpened?: () => void }) {
  const { model, status, open, markAllRead } = useInbox();
  const { pathname } = useLocation();
  const current = sessionIdFromPath(pathname);
  const now = useNow(60_000);
  const listRef = useRef<HTMLDivElement>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== "j" && event.key !== "k") return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-inbox-row]") ?? [],
    );
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "j"
        ? rows[Math.min(rows.length - 1, index + 1)]
        : rows[Math.max(0, index < 0 ? 0 : index - 1)];
    next?.focus();
  };

  const go = (row: InboxRow) => {
    open(row);
    onOpened?.();
  };
  const render = (rows: InboxRow[]) =>
    rows.map((row) => (
      <Row
        key={row.key}
        row={row}
        now={now}
        touch={touch}
        active={row.target.sessionId === current || row.sessionId === current}
        onOpen={() => go(row)}
      />
    ));

  if (status === "connecting") {
    return (
      <p role="status" className="type-meta px-2.5 py-3 text-basic-tertiary">
        Checking what needs you…
      </p>
    );
  }
  if (status === "unavailable") {
    return (
      <p role="status" className="type-meta px-2.5 py-3 text-basic-tertiary">
        Can’t check what needs you right now. Sessions still show their own requests.
      </p>
    );
  }

  const unread = model.failed.length + model.done.length;
  // Never a falsely clean inbox: the calm line only when nothing is unknown.
  const clear = model.needsYou.length === 0 && unread === 0 && model.unavailable.length === 0;

  return (
    <div
      ref={listRef}
      onKeyDown={onKeyDown}
      aria-label="Inbox"
      role="group"
      className="flex flex-col gap-3 pb-2"
    >
      {model.needsYou.length > 0 ? (
        <Section title="Needs you" count={model.needsYou.length}>
          {render(model.needsYou)}
        </Section>
      ) : null}
      {model.failed.length > 0 ? <Section title="Failed">{render(model.failed)}</Section> : null}
      {model.done.length > 0 ? <Section title="Done">{render(model.done)}</Section> : null}
      {clear ? (
        <div className="flex flex-col items-start gap-1 px-2.5 py-3">
          <p className="type-label text-basic-secondary">Nothing needs you</p>
          <p className="type-meta text-basic-tertiary">
            Approvals, questions and finished work show up here.
          </p>
        </div>
      ) : null}
      {unread > 0 ? (
        <button
          type="button"
          onClick={markAllRead}
          className={cn(
            "type-meta self-start rounded-pill px-2.5 text-basic-tertiary outline-none",
            touch ? "min-h-11" : "h-7",
            "hover:bg-[var(--f-wash-1)] hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
          )}
        >
          Mark all read
        </button>
      ) : null}
      {model.unavailable.length > 0 ? (
        <div className="flex flex-col">
          <button
            type="button"
            aria-expanded={showUnavailable}
            onClick={() => setShowUnavailable((value) => !value)}
            className={cn(
              "type-meta flex items-center gap-1 self-start rounded-pill px-2.5 text-basic-muted outline-none",
              touch ? "min-h-11" : "h-7",
              "hover:text-basic-secondary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
            )}
          >
            <Icon
              iconName={IconName.Right}
              size={12}
              className={cn(
                "transition-transform duration-150 motion-reduce:transition-none",
                showUnavailable && "rotate-90",
              )}
            />
            Status unavailable for {model.unavailable.length}{" "}
            {model.unavailable.length === 1 ? "session" : "sessions"}
          </button>
          {showUnavailable ? (
            <ul aria-label="Status unavailable" className="flex flex-col gap-px">
              {render(model.unavailable)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
