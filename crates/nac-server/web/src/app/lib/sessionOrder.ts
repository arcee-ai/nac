import { parseStoreTime } from "@/app/lib/format";
import type {
  ManagedSessionSummary,
  ReorderSessionsRequest,
  SessionSummarySnapshot,
} from "@/app/types/api";

export type DropEdge = "before" | "after";

/** Insert `id` at `index` in `ids`, removing any prior occurrence. */
export function placeIdAt(ids: string[], id: string, index: number): string[] {
  const without = ids.filter((other) => other !== id);
  const clamped = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, clamped), id, ...without.slice(clamped)];
}

/**
 * Lay `entries` out in the order the user dragged the tabs into.
 *
 * Chats started since that arrangement are not in it, and go to the front,
 * where the untouched newest-first order would have put them anyway.
 */
export function applyTabOrder(
  entries: ManagedSessionSummary[],
  order: readonly string[],
): ManagedSessionSummary[] {
  if (order.length === 0) return entries;
  const rank = new Map(order.map((id, index) => [id, index]));
  const placed: ManagedSessionSummary[] = [];
  const fresh: ManagedSessionSummary[] = [];
  for (const entry of entries) {
    (rank.has(entry.summary.session_id) ? placed : fresh).push(entry);
  }
  placed.sort(
    (a, b) => (rank.get(a.summary.session_id) ?? 0) - (rank.get(b.summary.session_id) ?? 0),
  );
  return [...fresh, ...placed];
}

/**
 * Spawned chats sit immediately to the right of the parent that created them.
 * Newest child of a parent is closest to it; grandchildren follow their own
 * parent the same way. A child whose parent is not on the strip stays put.
 */
export function placeSpawnsAfterParents(
  entries: ManagedSessionSummary[],
): ManagedSessionSummary[] {
  const present = new Set(entries.map((entry) => entry.summary.session_id));
  const children = new Map<string, ManagedSessionSummary[]>();
  const roots: ManagedSessionSummary[] = [];
  for (const entry of entries) {
    const parentId = entry.lineage?.parent_session_id;
    if (parentId && present.has(parentId)) {
      const bucket = children.get(parentId);
      if (bucket) bucket.push(entry);
      else children.set(parentId, [entry]);
    } else {
      roots.push(entry);
    }
  }
  const result: ManagedSessionSummary[] = [];
  const emitted = new Set<string>();
  const emit = (entry: ManagedSessionSummary): void => {
    const id = entry.summary.session_id;
    if (emitted.has(id)) return;
    emitted.add(id);
    result.push(entry);
    for (const child of children.get(id) ?? []) emit(child);
  };
  for (const entry of roots) emit(entry);
  for (const entry of entries) emit(entry);
  return result;
}

export function compareSortOrder(a: SessionSummarySnapshot, b: SessionSummarySnapshot): number {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    parseStoreTime(b.created_at) - parseStoreTime(a.created_at)
  );
}

/** Full pin-group membership in backend order (required by `/sessions/order`). */
export function pinGroup(
  entries: ManagedSessionSummary[],
  pinned: boolean,
): ManagedSessionSummary[] {
  return entries
    .filter((entry) => Boolean(entry.summary.pinned) === pinned)
    .sort((a, b) => compareSortOrder(a.summary, b.summary));
}

export function reorderRequest(
  pinned: boolean,
  sessionIds: string[],
  entries: ManagedSessionSummary[],
): ReorderSessionsRequest {
  const byId = new Map(entries.map((entry) => [entry.summary.session_id, entry]));
  const expected_versions: Record<string, number> = {};
  for (const id of sessionIds) {
    expected_versions[id] = byId.get(id)?.summary.presentation_version ?? 0;
  }
  return { pinned, session_ids: sessionIds, expected_versions };
}

/**
 * After a pin/unpin, the returned summary carries the new version; patch it
 * into the list used for the follow-up reorder.
 */
export function withUpdatedSummary(
  entries: ManagedSessionSummary[],
  summary: SessionSummarySnapshot,
): ManagedSessionSummary[] {
  return entries.map((entry) =>
    entry.summary.session_id === summary.session_id ? { ...entry, summary } : entry,
  );
}

/** Drop before/after a visible card → index in the full pin group. */
export function targetIndexInGroup(
  group: ManagedSessionSummary[],
  targetSessionId: string,
  edge: DropEdge,
  movingSessionId: string,
): number {
  // Dropping on the dragged card itself must keep its current index (no-op),
  // not fall through to "end of group".
  if (targetSessionId === movingSessionId) {
    const current = group.findIndex((entry) => entry.summary.session_id === movingSessionId);
    return current < 0 ? group.length : current;
  }

  const withoutMover = group.filter((entry) => entry.summary.session_id !== movingSessionId);
  const targetPos = withoutMover.findIndex((entry) => entry.summary.session_id === targetSessionId);
  if (targetPos < 0) return withoutMover.length;
  return edge === "before" ? targetPos : targetPos + 1;
}

/** True when the move would not change pin group membership or order. */
export function isNoOpMove(
  sessions: ManagedSessionSummary[],
  sessionId: string,
  targetPinned: boolean,
  targetIndex: number,
): boolean {
  const entry = sessions.find((e) => e.summary.session_id === sessionId);
  if (!entry) return true;
  if (Boolean(entry.summary.pinned) !== targetPinned) return false;
  const group = pinGroup(sessions, targetPinned);
  const currentIds = group.map((e) => e.summary.session_id);
  const nextIds = placeIdAt(currentIds, sessionId, targetIndex);
  return sameOrder(currentIds, nextIds);
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
