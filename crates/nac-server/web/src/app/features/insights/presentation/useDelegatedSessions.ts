import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useContext, useMemo } from "react";

import type {
  DelegatedRowKey,
  InsightSegment,
  InsightTurnSection,
} from "@/app/features/insights/model/types";
import { InsightsNavigationContext } from "@/app/features/insights/useInsightsNavigation";
import { queryKeys, useTraditionalChildren } from "@/app/services/queries";
import type { SessionSnapshotResponse, TraditionalChildRecord } from "@/app/types/api";

/** A delegated session this session's own records vouch for. */
export interface SessionLink {
  rowKey: DelegatedRowKey;
  title: string;
}

export type SessionResolver = (rowKey: DelegatedRowKey | null) => SessionLink | null;

const TARGET_PREFIX: Partial<Record<string, "child">> = {
  subagent_status: "child",
  subagent_cancel: "child",
};

/** The session a session tool addressed; its preview is the id the model passed. */
export function sessionTarget(segment: InsightSegment): DelegatedRowKey | null {
  if (segment.kind !== "tool") return null;
  const prefix = TARGET_PREFIX[segment.name];
  const id = segment.presentation?.summary?.trim();
  return prefix && id ? `${prefix}:${id}` : null;
}

function namedSessions(timeline: readonly InsightTurnSection[]): DelegatedRowKey[] {
  const named = new Set<DelegatedRowKey>();
  for (const section of timeline) {
    for (const entry of section.entries) {
      if (entry.kind === "session" && entry.rowKey) named.add(entry.rowKey);
      if (entry.kind !== "group") continue;
      for (const segment of entry.group.segments) {
        const target = sessionTarget(segment);
        if (target) named.add(target);
      }
    }
  }
  return [...named];
}

/**
 * Delegation records poll every second while enabled and nothing else
 * refreshes them, so they load only while a session the timeline names may
 * still be missing. A record never changes the title it gives.
 */
function awaitsRecords(
  named: readonly DelegatedRowKey[],
  knownIds: readonly string[] | undefined,
): boolean {
  const wanted = named.filter((key) => key.startsWith("child:"));
  if (!wanted.length) return false;
  if (!knownIds) return true;
  const known = new Set(knownIds.map((id) => `child:${id}`));
  return wanted.some((key) => !known.has(key));
}

/**
 * Ids in tool calls are the model's to choose, so a session is only named or
 * linked once the delegation records of this session list it.
 */
export function useDelegatedSessions(
  sessionId: string,
  _snapshot: SessionSnapshotResponse | null,
  timeline: readonly InsightTurnSection[],
): SessionResolver {
  const { panels } = useContext(InsightsNavigationContext);
  const cache = useQueryClient();
  const named = useMemo(() => namedSessions(timeline), [timeline]);
  const delegating = panels.includes("delegated");
  // The gates read the cache: the hooks only return their records once called.
  const cachedChildren = cache.getQueryData<TraditionalChildRecord[]>(
    queryKeys.traditionalChildren(sessionId),
  );
  const children = useTraditionalChildren(
    sessionId,
    delegating &&
      awaitsRecords(
        named,
        cachedChildren?.map((child) => child.child_session_id),
      ),
  );
  const childRecords = children.data;

  const titles = useMemo(() => {
    const known = new Map<DelegatedRowKey, string>();
    for (const child of childRecords ?? []) {
      known.set(`child:${child.child_session_id}`, child.description.trim());
    }
    return known;
  }, [childRecords]);

  return useCallback(
    (rowKey) => {
      if (!rowKey) return null;
      const title = titles.get(rowKey);
      return title === undefined ? null : { rowKey, title };
    },
    [titles],
  );
}
