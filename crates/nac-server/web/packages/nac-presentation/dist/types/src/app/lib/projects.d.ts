import type { ManagedSessionSummary, ProjectRecord } from "../types/api";
/** Delegated descendants are reachable through their parent's hierarchy only. */
export declare function primarySessions(sessions: ManagedSessionSummary[]): ManagedSessionSummary[];
/** A project together with the sessions that belong to it. */
export interface ProjectEntry {
    project: ProjectRecord;
    sessions: ManagedSessionSummary[];
    /** How many of those sessions have a live run. */
    running: number;
    /** Micro-USD across the project, summed from the sessions. */
    totalCostMicros: number;
    /** Newest session activity, falling back to the project's own timestamp. */
    updatedAt: string;
}
export declare function newestPrimarySessionForProject(sessions: ManagedSessionSummary[], projectId: string): ManagedSessionSummary | null;
/**
 * The sibling whose model settings the server inherits for a new chat when a
 * project has no saved default. This is creation order, deliberately distinct
 * from the activity order used to choose which existing chat to open.
 */
export declare function newestCreatedPrimarySessionForProject(sessions: ManagedSessionSummary[], projectId: string): ManagedSessionSummary | null;
/**
 * Join projects with their sessions, newest session first inside each project.
 * Backend order is preserved so pinned projects stay on top.
 */
export declare function projectEntries(projects: ProjectRecord[], sessions: ManagedSessionSummary[]): ProjectEntry[];
/** Sessions that predate projects, or whose project was deleted, in backend order. */
export declare function orphanSessions(sessions: ManagedSessionSummary[]): ManagedSessionSummary[];
/**
 * One row of a project surface. Unassigned sessions share the listing with
 * projects rather than getting a screen of their own, so nothing a user started
 * before projects existed becomes unreachable.
 */
export type ProjectListItem = {
    kind: "project";
    entry: ProjectEntry;
} | {
    kind: "orphan";
    session: ManagedSessionSummary;
};
export declare function projectListItemId(item: ProjectListItem): string;
/** Projects in backend order (pinned first), then unassigned chats in theirs. */
export declare function projectListItems(projects: ProjectRecord[], sessions: ManagedSessionSummary[]): ProjectListItem[];
export declare function findProject(projects: ProjectRecord[], projectId: string | null | undefined): ProjectRecord | null;
/** The four fields the backend treats as one SSH/workspace location. */
export type SessionLocation = {
    cwd: string;
    ssh_host?: string | null;
    ssh_port?: number | null;
    ssh_identity_file?: string | null;
};
export declare function sameSessionLocation(left: SessionLocation, right: SessionLocation): boolean;
/** Location fields a create-project request must copy from a session. */
export declare function projectLocationPayload(summary: SessionLocation): {
    cwd: string;
    ssh_host: string | null;
    ssh_port: number | null;
    ssh_identity_file: string | null;
};
/**
 * A project can only adopt a session that already runs in its exact location,
 * because the session keeps its own `cwd` and the backend refuses a mismatch.
 */
export declare function projectForSessionLocation(projects: ProjectRecord[], summary: SessionLocation | null | undefined): ProjectRecord | null;
export type RecencyBucket = "Pinned" | "Today" | "Yesterday" | "This week" | "This month" | "Older";
export interface RecencyGroup<T> {
    label: RecencyBucket;
    items: T[];
}
/**
 * Bucket by last activity for the date-separated lists, with pinned items
 * lifted out of the date buckets entirely. Empty buckets are dropped, and the
 * order within each bucket is whatever the caller passed in.
 */
export declare function groupByRecency<T>(items: T[], describe: (item: T) => {
    updatedAt: string;
    pinned: boolean;
}, now: number): RecencyGroup<T>[];
