/**
 * The Inbox, derived. Pure: no React, no runtime. It turns the fleet's
 * attention facts (one entry per session, from `useFleetAttention`) plus the
 * session list and this device's read marks into three quiet groups:
 *
 * - Needs you — pending approvals, agent questions and blocked automatic
 *   reviews. One row per top-level session: a subagent's decision rolls up to
 *   its parent's row. Oldest-waiting first. Only these count toward the badge,
 *   and they cannot be dismissed: they leave when the decision is resolved.
 * - Failed — a top-level session whose last run failed, until it is opened.
 * - Done — finished work not opened since, newest first.
 *
 * Running work is not in the Inbox (it lives on status dots), so the Inbox
 * can reach zero. A session whose decision facets could not be observed is
 * never shown as clean: it gets a muted "Status unavailable" row.
 */

export type AttentionFacet = "available" | "unknown" | "unsupported";

export type AttentionDecision =
  | { kind: "permission"; request_id: string }
  | { kind: "review"; review_id: string }
  | { kind: "question"; request_id: string };

/** The fleet attention fields the Inbox reads (structurally the API's session DTO). */
export interface SessionAttentionFacts {
  session_id: string;
  pending: readonly AttentionDecision[];
  availability: { permissions: AttentionFacet; questions: AttentionFacet; reviews: AttentionFacet };
  last_outcome: { disposition: "completed" | "failed" | "cancelled"; run_id: string } | null;
  activity: { kind: string };
}

export interface InboxSessionFacts {
  id: string;
  title: string;
  projectName: string | null;
  parentId: string | null;
  /** Last activity, epoch ms. */
  updatedAt: number;
  /** Durable runs that deliberately produced no user-facing heartbeat update. */
  quietHeartbeatRunIds?: readonly string[];
}

export interface InboxReadState {
  /** Outcomes before this moment (epoch ms) count as read on a new device. */
  since: number;
  /** The outcome run id last seen per session. */
  runs: Readonly<Record<string, string>>;
}

export type InboxGroup = "needs-you" | "failed" | "done" | "unavailable";

export interface InboxTarget {
  sessionId: string;
  /** The exact permission request to focus on arrival. */
  permissionRequestId?: string;
  questionRequestId?: string;
  reviewId?: string;
}

export interface InboxRow {
  key: string;
  group: InboxGroup;
  /** The top-level session the row stands for. */
  sessionId: string;
  title: string;
  projectName: string | null;
  /** One quiet line: "2 approvals", "Approval needed from <child>", "Failed"… */
  detail: string;
  target: InboxTarget;
  /** Waiting since (needs-you) or finished at (failed/done), epoch ms. */
  at: number;
  approvals: number;
  questions: number;
  reviews: number;
  /** The outcome this row reports, so opening it can mark it read. */
  outcomeRunId?: string;
}

export interface InboxModel {
  needsYou: InboxRow[];
  failed: InboxRow[];
  done: InboxRow[];
  unavailable: InboxRow[];
  /** Needs-you rows: the number on the Inbox switch and Home's line. */
  badge: number;
}

/** How long before first use a finished run still counts as unread. */
export const READ_GRACE_MS = 10 * 60 * 1000;

export function decisionKey(sessionId: string, decision: AttentionDecision): string {
  return `${sessionId}:${decision.kind}:${decision.kind === "review" ? decision.review_id : decision.request_id}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2 approvals · 1 question". */
function countsLabel(approvals: number, questions: number, reviews: number): string {
  return [
    approvals ? plural(approvals, "approval") : null,
    questions ? plural(questions, "question") : null,
    reviews ? plural(reviews, "blocked review") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function singleLabel(decision: AttentionDecision): string {
  if (decision.kind === "permission") return "Approval needed";
  if (decision.kind === "question") return "Question waiting";
  return "Review blocked";
}

export function isUnread(read: InboxReadState, sessionId: string, runId: string, at: number) {
  if (read.runs[sessionId] === runId) return false;
  return at >= read.since - READ_GRACE_MS;
}

export function deriveInbox({
  sessions,
  attention,
  read,
  firstSeen,
}: {
  sessions: readonly InboxSessionFacts[];
  attention: ReadonlyMap<string, SessionAttentionFacts>;
  read: InboxReadState;
  /** When this device first saw each pending decision (`decisionKey`). */
  firstSeen: ReadonlyMap<string, number>;
}): InboxModel {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const rootOf = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    for (;;) {
      const parent = byId.get(current)?.parentId;
      if (!parent || seen.has(parent) || !byId.has(parent)) return current;
      seen.add(current);
      current = parent;
    }
  };

  interface Waiting {
    sessionId: string;
    decision: AttentionDecision;
    since: number;
  }
  const waitingByRoot = new Map<string, Waiting[]>();
  const blindRoots = new Set<string>();

  for (const session of sessions) {
    const facts = attention.get(session.id);
    const root = rootOf(session.id);
    if (!facts) {
      blindRoots.add(root);
      continue;
    }
    for (const decision of facts.pending) {
      const since = firstSeen.get(decisionKey(session.id, decision)) ?? session.updatedAt;
      const list = waitingByRoot.get(root) ?? [];
      list.push({ sessionId: session.id, decision, since });
      waitingByRoot.set(root, list);
    }
    const { permissions, questions, reviews } = facts.availability;
    if (
      [permissions, questions, reviews].every((facet) => facet === "unsupported") ||
      [permissions, questions, reviews].some((facet) => facet === "unknown")
    ) {
      blindRoots.add(root);
    }
  }

  const needsYou: InboxRow[] = [];
  for (const [rootId, waiting] of waitingByRoot) {
    const root = byId.get(rootId);
    if (!root) continue;
    waiting.sort((left, right) => left.since - right.since);
    const first = waiting[0];
    const approvals = waiting.filter((item) => item.decision.kind === "permission").length;
    const questions = waiting.filter((item) => item.decision.kind === "question").length;
    const reviews = waiting.filter((item) => item.decision.kind === "review").length;
    const fromChild = first.sessionId !== rootId ? byId.get(first.sessionId) : undefined;
    const detail =
      waiting.length === 1
        ? fromChild
          ? `${singleLabel(first.decision)} from ${fromChild.title}`
          : singleLabel(first.decision)
        : `${countsLabel(approvals, questions, reviews)}${fromChild ? ` · first from ${fromChild.title}` : ""}`;
    needsYou.push({
      key: `needs-you:${rootId}`,
      group: "needs-you",
      sessionId: rootId,
      title: root.title,
      projectName: root.projectName,
      detail,
      target: {
        sessionId: first.sessionId,
        permissionRequestId:
          first.decision.kind === "permission" ? first.decision.request_id : undefined,
        questionRequestId:
          first.decision.kind === "question" ? first.decision.request_id : undefined,
        reviewId: first.decision.kind === "review" ? first.decision.review_id : undefined,
      },
      at: first.since,
      approvals,
      questions,
      reviews,
    });
  }
  needsYou.sort((left, right) => left.at - right.at);

  const failed: InboxRow[] = [];
  const done: InboxRow[] = [];
  const unavailable: InboxRow[] = [];
  for (const session of sessions) {
    if (session.parentId && byId.has(session.parentId)) continue;
    if (waitingByRoot.has(session.id)) continue;
    const facts = attention.get(session.id);
    if (blindRoots.has(session.id)) {
      unavailable.push({
        key: `unavailable:${session.id}`,
        group: "unavailable",
        sessionId: session.id,
        title: session.title,
        projectName: session.projectName,
        detail: "Status unavailable",
        target: { sessionId: session.id },
        at: session.updatedAt,
        approvals: 0,
        questions: 0,
        reviews: 0,
      });
      continue;
    }
    const outcome = facts?.last_outcome;
    if (!outcome || facts?.activity.kind === "run") continue;
    if (!isUnread(read, session.id, outcome.run_id, session.updatedAt)) continue;
    if (outcome.disposition === "cancelled") continue;
    if (
      outcome.disposition === "completed" &&
      session.quietHeartbeatRunIds?.includes(outcome.run_id)
    )
      continue;
    const row: InboxRow = {
      key: `${outcome.disposition}:${session.id}`,
      group: outcome.disposition === "failed" ? "failed" : "done",
      sessionId: session.id,
      title: session.title,
      projectName: session.projectName,
      detail: outcome.disposition === "failed" ? "Run failed" : "Finished",
      target: { sessionId: session.id },
      at: session.updatedAt,
      approvals: 0,
      questions: 0,
      reviews: 0,
      outcomeRunId: outcome.run_id,
    };
    (outcome.disposition === "failed" ? failed : done).push(row);
  }
  failed.sort((left, right) => right.at - left.at);
  done.sort((left, right) => right.at - left.at);
  unavailable.sort((left, right) => right.at - left.at);

  return { needsYou, failed, done, unavailable, badge: needsYou.length };
}

/** The first session that needs the user, oldest-waiting first. */
export function nextNeedsYou(model: InboxModel, after?: string): InboxRow | null {
  if (model.needsYou.length === 0) return null;
  const index = after
    ? model.needsYou.findIndex((row) => row.sessionId === after || row.target.sessionId === after)
    : -1;
  return model.needsYou[(index + 1) % model.needsYou.length] ?? null;
}
