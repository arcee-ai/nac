// Projects are stored without any rollup of the sessions inside them, so the
// counts, spend and running state every project surface shows are joined here
// from the session list the app already polls.

import { isActiveRun, parseStoreTime } from "@/app/lib/format";
import { compareSortOrder } from "@/app/lib/sessionOrder";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

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

function newestUpdate(sessions: ManagedSessionSummary[], fallback: string): string {
  let newest = fallback;
  for (const entry of sessions) {
    if (parseStoreTime(entry.summary.updated_at) > parseStoreTime(newest)) {
      newest = entry.summary.updated_at;
    }
  }
  return newest;
}

function bySessionRecency(a: ManagedSessionSummary, b: ManagedSessionSummary): number {
  return parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at);
}

/**
 * Join projects with their sessions, newest session first inside each project.
 * Backend order is preserved so pinned projects stay on top.
 */
export function projectEntries(
  projects: ProjectRecord[],
  sessions: ManagedSessionSummary[],
): ProjectEntry[] {
  const byProject = new Map<string, ManagedSessionSummary[]>();
  for (const entry of sessions) {
    const projectId = entry.summary.project_id;
    if (!projectId) continue;
    const bucket = byProject.get(projectId);
    if (bucket) bucket.push(entry);
    else byProject.set(projectId, [entry]);
  }

  return projects.map((project) => {
    const owned = (byProject.get(project.project_id) ?? []).sort(bySessionRecency);
    return {
      project,
      sessions: owned,
      running: owned.filter((entry) => isActiveRun(entry.active_run)).length,
      totalCostMicros: owned.reduce(
        (total, entry) => total + (entry.summary.total_cost_micros ?? 0),
        0,
      ),
      updatedAt: newestUpdate(owned, project.updated_at),
    };
  });
}

/** Sessions that predate projects, or whose project was deleted, in backend order. */
export function orphanSessions(sessions: ManagedSessionSummary[]): ManagedSessionSummary[] {
  return sessions
    .filter((entry) => !entry.summary.project_id)
    .sort((a, b) => compareSortOrder(a.summary, b.summary));
}

/**
 * One row of a project surface. Unassigned sessions share the listing with
 * projects rather than getting a screen of their own, so nothing a user started
 * before projects existed becomes unreachable.
 */
export type ProjectListItem =
  | { kind: "project"; entry: ProjectEntry }
  | { kind: "orphan"; session: ManagedSessionSummary };

export function projectListItemId(item: ProjectListItem): string {
  return item.kind === "project" ? item.entry.project.project_id : item.session.summary.session_id;
}

/** Projects in backend order (pinned first), then unassigned chats in theirs. */
export function projectListItems(
  projects: ProjectRecord[],
  sessions: ManagedSessionSummary[],
): ProjectListItem[] {
  return [
    ...projectEntries(projects, sessions).map((entry): ProjectListItem => ({
      kind: "project",
      entry,
    })),
    ...orphanSessions(sessions).map((session): ProjectListItem => ({ kind: "orphan", session })),
  ];
}

export function findProject(
  projects: ProjectRecord[],
  projectId: string | null | undefined,
): ProjectRecord | null {
  if (!projectId) return null;
  return projects.find((project) => project.project_id === projectId) ?? null;
}

/** The four fields the backend treats as one SSH/workspace location. */
export type SessionLocation = {
  cwd: string;
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_identity_file?: string | null;
};

export function sameSessionLocation(left: SessionLocation, right: SessionLocation): boolean {
  return (
    left.cwd === right.cwd &&
    (left.ssh_host ?? null) === (right.ssh_host ?? null) &&
    (left.ssh_port ?? null) === (right.ssh_port ?? null) &&
    (left.ssh_identity_file ?? null) === (right.ssh_identity_file ?? null)
  );
}

/** Location fields a create-project request must copy from a session. */
export function projectLocationPayload(summary: SessionLocation): {
  cwd: string;
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_identity_file: string | null;
} {
  return {
    cwd: summary.cwd,
    ssh_host: summary.ssh_host ?? null,
    ssh_port: summary.ssh_port ?? null,
    ssh_identity_file: summary.ssh_identity_file ?? null,
  };
}

/**
 * A project can only adopt a session that already runs in its exact location,
 * because the session keeps its own `cwd` and the backend refuses a mismatch.
 */
export function projectForSessionLocation(
  projects: ProjectRecord[],
  summary: SessionLocation | null | undefined,
): ProjectRecord | null {
  if (!summary) return null;
  return projects.find((project) => sameSessionLocation(project, summary)) ?? null;
}

export type RecencyBucket = "Pinned" | "Today" | "Yesterday" | "This week" | "This month" | "Older";

const BUCKET_ORDER: RecencyBucket[] = [
  "Pinned",
  "Today",
  "Yesterday",
  "This week",
  "This month",
  "Older",
];

export interface RecencyGroup<T> {
  label: RecencyBucket;
  items: T[];
}

function startOfLocalDay(at: number): Date {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysAgo(today: Date, days: number): number {
  const date = new Date(today);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

function bucketFor(updatedAt: string, now: number): RecencyBucket {
  const timestamp = parseStoreTime(updatedAt);
  if (!Number.isFinite(timestamp)) return "Older";
  const today = startOfLocalDay(now);
  if (timestamp >= today.getTime()) return "Today";
  if (timestamp >= daysAgo(today, 1)) return "Yesterday";
  if (timestamp >= daysAgo(today, 7)) return "This week";
  if (timestamp >= daysAgo(today, 30)) return "This month";
  return "Older";
}

/**
 * Bucket by last activity for the date-separated lists, with pinned items
 * lifted out of the date buckets entirely. Empty buckets are dropped, and the
 * order within each bucket is whatever the caller passed in.
 */
export function groupByRecency<T>(
  items: T[],
  describe: (item: T) => { updatedAt: string; pinned: boolean },
  now: number,
): RecencyGroup<T>[] {
  const buckets = new Map<RecencyBucket, T[]>();
  for (const item of items) {
    const { updatedAt, pinned } = describe(item);
    const label = pinned ? "Pinned" : bucketFor(updatedAt, now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(item);
    else buckets.set(label, [item]);
  }
  return BUCKET_ORDER.flatMap((label) => {
    const items = buckets.get(label);
    return items && items.length > 0 ? [{ label, items }] : [];
  });
}
