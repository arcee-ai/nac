import { parseStoreTime } from "@/app/lib/format";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

export interface SessionNavigationItem {
  session: ManagedSessionSummary;
  projectLabel: string;
}

export interface SessionNavigationGroup {
  key: string;
  label: string;
  sessions: ManagedSessionSummary[];
}

export interface SessionNavigationModel {
  pinned: SessionNavigationItem[];
  groups: SessionNavigationGroup[];
}

const byRecentActivity = (left: ManagedSessionSummary, right: ManagedSessionSummary): number =>
  parseStoreTime(right.summary.updated_at) - parseStoreTime(left.summary.updated_at);

/**
 * Builds the global collection without changing server ownership or server-side
 * presentation. Delegated descendants stay reachable through their parent and
 * never become independent rows here.
 */
export function buildSessionNavigation(
  projects: ProjectRecord[],
  sessions: ManagedSessionSummary[],
  pinnedIds: ReadonlySet<string>,
): SessionNavigationModel {
  const parents = sessions.filter((entry) => entry.lineage == null);
  const projectById = new Map(projects.map((project) => [project.project_id, project]));
  const projectLabel = (entry: ManagedSessionSummary): string => {
    const projectId = entry.summary.project_id;
    if (!projectId) return "Unassigned";
    return projectById.get(projectId)?.name ?? `Project ${projectId}`;
  };
  const pinned = parents
    .filter((entry) => pinnedIds.has(entry.summary.session_id))
    .sort(byRecentActivity)
    .map((session) => ({ session, projectLabel: projectLabel(session) }));
  const unpinned = parents.filter((entry) => !pinnedIds.has(entry.summary.session_id));

  const groups: SessionNavigationGroup[] = [];
  for (const project of projects) {
    const owned = unpinned
      .filter((entry) => entry.summary.project_id === project.project_id)
      .sort(byRecentActivity);
    if (owned.length > 0) {
      groups.push({ key: project.project_id, label: project.name, sessions: owned });
    }
  }

  const knownIds = new Set(projects.map((project) => project.project_id));
  const unavailable = new Map<string, ManagedSessionSummary[]>();
  for (const entry of unpinned) {
    const projectId = entry.summary.project_id;
    if (!projectId || knownIds.has(projectId)) continue;
    const bucket = unavailable.get(projectId);
    if (bucket) bucket.push(entry);
    else unavailable.set(projectId, [entry]);
  }
  for (const [projectId, owned] of [...unavailable].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    groups.push({
      key: `unavailable:${projectId}`,
      label: `Project ${projectId}`,
      sessions: owned.sort(byRecentActivity),
    });
  }

  const unassigned = unpinned
    .filter((entry) => entry.summary.project_id == null)
    .sort(byRecentActivity);
  if (unassigned.length > 0) {
    groups.push({ key: "unassigned", label: "Unassigned", sessions: unassigned });
  }

  return { pinned, groups };
}

/** A session is unread only when authoritative server activity is newer. */
export function isSessionUnread(updatedAt: string, lastViewedAt: string | undefined): boolean {
  const updated = parseStoreTime(updatedAt);
  if (!Number.isFinite(updated)) return false;
  if (!lastViewedAt) return true;
  const viewed = parseStoreTime(lastViewedAt);
  return !Number.isFinite(viewed) || updated > viewed;
}
