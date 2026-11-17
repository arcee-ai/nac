/**
 * One status ladder for every place a session's state is shown: sidebar rows,
 * Home cards, the session header, the palette, parent roll-ups. Most urgent
 * first; a row shows only its top rung.
 */
export type SessionStatus =
  | "needs-approval"
  | "needs-answer"
  | "failed"
  | "working"
  | "waiting"
  | "done"
  | "idle";

export const SESSION_STATUS_ORDER: readonly SessionStatus[] = [
  "needs-approval",
  "needs-answer",
  "failed",
  "working",
  "waiting",
  "done",
  "idle",
];

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  "needs-approval": "Needs approval",
  "needs-answer": "Needs an answer",
  failed: "Failed",
  working: "Working",
  waiting: "Waiting on subagents",
  done: "Done",
  idle: "Idle",
};

export interface SessionStatusFacts {
  pendingPermissions?: number;
  pendingQuestions?: number;
  /** Last run failed and the user has not opened it since. */
  failedUnseen?: boolean;
  running?: boolean;
  /** Idle itself, but at least one child is working. */
  childrenRunning?: boolean;
  /** Finished (or a heartbeat produced news) since the user last looked. */
  attention?: boolean;
}

export function sessionStatus(facts: SessionStatusFacts): SessionStatus {
  if ((facts.pendingPermissions ?? 0) > 0) return "needs-approval";
  if ((facts.pendingQuestions ?? 0) > 0) return "needs-answer";
  if (facts.failedUnseen) return "failed";
  if (facts.running) return "working";
  if (facts.childrenRunning) return "waiting";
  if (facts.attention) return "done";
  return "idle";
}

/** The most urgent of several statuses (a parent's roll-up of its children). */
export function mostUrgent(statuses: Iterable<SessionStatus>): SessionStatus {
  let best = SESSION_STATUS_ORDER.length - 1;
  for (const status of statuses) best = Math.min(best, SESSION_STATUS_ORDER.indexOf(status));
  return SESSION_STATUS_ORDER[best];
}

/** Statuses that belong in Home's "Needs you" group. */
export function needsYou(status: SessionStatus): boolean {
  return status === "needs-approval" || status === "needs-answer" || status === "failed";
}
