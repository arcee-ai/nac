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
export type AttentionDecision = {
    kind: "permission";
    request_id: string;
} | {
    kind: "review";
    review_id: string;
} | {
    kind: "question";
    request_id: string;
};
/** The fleet attention fields the Inbox reads (structurally the API's session DTO). */
export interface SessionAttentionFacts {
    session_id: string;
    pending: readonly AttentionDecision[];
    availability: {
        permissions: AttentionFacet;
        questions: AttentionFacet;
        reviews: AttentionFacet;
    };
    last_outcome: {
        disposition: "completed" | "failed" | "cancelled";
        run_id: string;
    } | null;
    activity: {
        kind: string;
    };
}
export interface InboxSessionFacts {
    id: string;
    title: string;
    projectName: string | null;
    parentId: string | null;
    /** Last activity, epoch ms. */
    updatedAt: number;
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
export declare const READ_GRACE_MS: number;
export declare function decisionKey(sessionId: string, decision: AttentionDecision): string;
export declare function isUnread(read: InboxReadState, sessionId: string, runId: string, at: number): boolean;
export declare function deriveInbox({ sessions, attention, read, firstSeen, }: {
    sessions: readonly InboxSessionFacts[];
    attention: ReadonlyMap<string, SessionAttentionFacts>;
    read: InboxReadState;
    /** When this device first saw each pending decision (`decisionKey`). */
    firstSeen: ReadonlyMap<string, number>;
}): InboxModel;
/** The first session that needs the user, oldest-waiting first. */
export declare function nextNeedsYou(model: InboxModel, after?: string): InboxRow | null;
