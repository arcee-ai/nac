import { useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { NEXT_NEEDS_YOU_KEYS } from "@/app/lib/shortcuts";
import { useFleetAttention, useProjects, useVisibleSessions } from "@/app/services/queries";

import {
  decisionKey,
  deriveInbox,
  nextNeedsYou,
  type InboxRow,
  type InboxSessionFacts,
} from "./inboxModel";
import {
  EMPTY_INBOX,
  InboxContext,
  inboxHref,
  useInbox,
  type InboxContextValue,
} from "./inboxContext";
import { inboxReadStore } from "./readStore";

/** When this device first saw each pending decision; the oldest waits longest. */
const firstSeen = new Map<string, number>();

/**
 * One fleet attention subscription for the whole app (one stream serves every
 * tab and view), turned into the Inbox model every surface reads: the
 * sidebar's switch badge, Home's "N need you" line, the list and the palette.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // The /design showcase is a static page: it reads nothing from the server.
  if (pathname === routes.designPreview()) return <>{children}</>;
  return <LiveInboxProvider>{children}</LiveInboxProvider>;
}

function LiveInboxProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const fleet = useFleetAttention();
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectsData } = useProjects();
  const titleOf = useSessionTitle();
  const reads = inboxReadStore();
  const read = reads.useReadState();
  const facts = useMemo<InboxSessionFacts[]>(() => {
    const projectName = new Map(
      (projectsData?.projects ?? []).map((project) => [project.project_id, project.name]),
    );
    return sessions.map((entry) => ({
      id: entry.summary.session_id,
      title: titleOf(entry.summary),
      projectName: entry.summary.project_id
        ? (projectName.get(entry.summary.project_id) ?? null)
        : null,
      parentId: entry.lineage?.parent_session_id ?? null,
      updatedAt: Date.parse(entry.summary.updated_at) || 0,
    }));
    // titleOf is rebuilt every render; the session list decides the titles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, projectsData]);

  const usable = fleet.status !== "unavailable" && fleet.status !== "connecting";
  // Stamp decisions the first time this device sees them. Until then a
  // decision orders by its session's last activity, which is close.
  useEffect(() => {
    const now = Date.now();
    for (const [sessionId, session] of fleet.sessions) {
      for (const decision of session.pending) {
        const key = decisionKey(sessionId, decision);
        if (!firstSeen.has(key)) firstSeen.set(key, now);
      }
    }
  }, [fleet.sessions]);

  const model = useMemo(
    () =>
      usable
        ? deriveInbox({ sessions: facts, attention: fleet.sessions, read, firstSeen })
        : EMPTY_INBOX,
    [usable, facts, fleet.sessions, read],
  );

  const open = useCallback(
    (row: InboxRow) => {
      if (row.outcomeRunId) reads.markRead(row.sessionId, row.outcomeRunId);
      navigate(inboxHref(row.target));
    },
    [navigate, reads],
  );

  const current = sessionIdFromPath(pathname);
  const openNext = useCallback(() => {
    const row = nextNeedsYou(model, current ?? undefined);
    if (row) open(row);
  }, [model, current, open]);

  useKeyboardShortcuts([
    { keys: NEXT_NEEDS_YOU_KEYS, onTrigger: openNext, enabled: model.badge > 0 },
  ]);

  const value = useMemo<InboxContextValue>(
    () => ({
      model,
      status: fleet.status,
      attention: fleet.sessions,
      lastOutcomeRun: (sessionId) => fleet.sessions.get(sessionId)?.last_outcome?.run_id ?? null,
      open,
      openNext,
      markRead: reads.markRead,
      markAllRead: () =>
        reads.markAllRead(
          [...model.failed, ...model.done].flatMap((row) =>
            row.outcomeRunId ? [{ sessionId: row.sessionId, runId: row.outcomeRunId }] : [],
          ),
        ),
    }),
    [model, fleet.status, fleet.sessions, open, openNext, reads],
  );

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

/**
 * Opening a session reads its latest outcome on this device: a Failed or
 * Done row clears as soon as you look at it.
 */
export function InboxReadMarker({ sessionId }: { sessionId: string }) {
  const { lastOutcomeRun, markRead } = useInbox();
  const runId = lastOutcomeRun(sessionId);
  useEffect(() => {
    if (runId) markRead(sessionId, runId);
  }, [markRead, runId, sessionId]);
  return null;
}
