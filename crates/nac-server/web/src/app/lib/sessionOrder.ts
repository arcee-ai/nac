import type {
  ManagedSessionSummary,
  ReorderSessionsRequest,
  SessionSummarySnapshot,
} from "@/app/types/api";

export type DropEdge = "before" | "after";

/** Insert `sessionId` at `index` in `ids`, removing any prior occurrence. */
export function placeSessionId(
  ids: string[],
  sessionId: string,
  index: number,
): string[] {
  const without = ids.filter((id) => id !== sessionId);
  const clamped = Math.max(0, Math.min(index, without.length));
  return [
    ...without.slice(0, clamped),
    sessionId,
    ...without.slice(clamped),
  ];
}

export function compareSortOrder(
  a: SessionSummarySnapshot,
  b: SessionSummarySnapshot,
): number {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    Date.parse(b.created_at) - Date.parse(a.created_at)
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
  const byId = new Map(
    entries.map((entry) => [entry.summary.session_id, entry]),
  );
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
    entry.summary.session_id === summary.session_id
      ? { ...entry, summary }
      : entry,
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
    const current = group.findIndex(
      (entry) => entry.summary.session_id === movingSessionId,
    );
    return current < 0 ? group.length : current;
  }

  const withoutMover = group.filter(
    (entry) => entry.summary.session_id !== movingSessionId,
  );
  const targetPos = withoutMover.findIndex(
    (entry) => entry.summary.session_id === targetSessionId,
  );
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
  const nextIds = placeSessionId(currentIds, sessionId, targetIndex);
  return sameOrder(currentIds, nextIds);
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
