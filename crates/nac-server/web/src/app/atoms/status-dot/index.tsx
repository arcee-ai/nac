import { cn } from "../../lib/cn";
import { SESSION_STATUS_LABEL, type SessionStatus } from "../../lib/sessionStatus";

const DOT: Record<SessionStatus, string> = {
  "needs-approval": "bg-[var(--f-amber)]",
  "needs-answer": "bg-[var(--f-amber)]",
  failed: "bg-[var(--f-red)]",
  working: "bg-[var(--f-ink)] status-dot-pulse",
  waiting: "border border-[var(--f-ink-4)] bg-transparent",
  done: "bg-[var(--f-green)]",
  idle: "bg-[var(--f-ink-5)] opacity-60",
};

/**
 * The status ladder's glyph: a 6px dot (8px with `size="md"`). Amber needs
 * you, red failed, a breathing ink dot is working, a ring waits on children,
 * green is finished-and-unseen, a faint dot is idle. The label is always
 * available to assistive technology; pass `labelled` to also show it.
 */
export default function StatusDot({
  status,
  size = "sm",
  labelled = false,
  hideIdle = false,
  className,
}: {
  status: SessionStatus;
  size?: "sm" | "md";
  labelled?: boolean;
  /** Render nothing at all for idle sessions (keeps quiet rows quiet). */
  hideIdle?: boolean;
  className?: string;
}) {
  if (hideIdle && status === "idle") return null;
  const label = SESSION_STATUS_LABEL[status];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
      data-status={status}
    >
      <span
        aria-hidden
        className={cn("block rounded-pill", size === "md" ? "size-2" : "size-1.5", DOT[status])}
      />
      {labelled ? (
        <span className="type-meta text-basic-tertiary">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}
