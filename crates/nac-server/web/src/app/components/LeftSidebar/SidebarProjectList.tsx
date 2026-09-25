import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  ChatSessionButton,
  Icon,
  IconName,
  ProjectButton,
  ProjectButtonVariant,
  TabButton,
} from "@/app/atoms";
import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun } from "@/app/lib/format";
import { groupByRecency, projectEntries } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

/** Date buckets only shift once a day. */
const RECENCY_TICK_MS = 60_000;
/** Unpinned rows kept visible before "See N more" opens the rest. */
const PREVIEW_LIMIT = 4;

/**
 * Projects as collapsible groups. The project on screen starts open; a search
 * keeps only the rows that match and opens every group that still has one.
 */
export function SidebarProjectList({
  projects,
  sessions,
  query,
  activeSessionId,
  activeProjectId,
}: {
  projects: ProjectRecord[];
  sessions: ManagedSessionSummary[];
  query: string;
  activeSessionId: string | null;
  activeProjectId: string | null;
}) {
  const navigate = useNavigate();
  const sessionTitle = useSessionTitle();
  const now = useNow(RECENCY_TICK_MS);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const needle = query.trim().toLowerCase();

  const entries = useMemo(() => projectEntries(projects, sessions), [projects, sessions]);
  const orphans = useMemo(
    () => sessions.filter((entry) => entry.lineage == null && !entry.summary.project_id),
    [sessions],
  );

  const isExpanded = (projectId: string) => {
    if (needle) return true;
    if (closed.has(projectId)) return false;
    return opened.has(projectId) || projectId === activeProjectId;
  };

  const toggle = (projectId: string) => {
    if (isExpanded(projectId)) {
      setClosed((current) => new Set(current).add(projectId));
      setOpened((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
      return;
    }
    setOpened((current) => new Set(current).add(projectId));
    setClosed((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  };

  const visibleEntries = entries.filter((entry) => {
    if (!needle) return true;
    if (entry.project.name.toLowerCase().includes(needle)) return true;
    return entry.sessions.some((session) =>
      sessionTitle(session.summary).toLowerCase().includes(needle),
    );
  });

  const visibleOrphans = orphans.filter(
    (entry) => !needle || sessionTitle(entry.summary).toLowerCase().includes(needle),
  );

  if (visibleEntries.length === 0 && visibleOrphans.length === 0) {
    return <p className="label-small text-basic-muted px-4 py-3">No matching sessions</p>;
  }

  return (
    <div className="flex flex-col [&>*]:shrink-0">
      {visibleEntries.map((entry) => {
        const projectId = entry.project.project_id;
        const open = isExpanded(projectId);
        const projectMatches = entry.project.name.toLowerCase().includes(needle);
        const sessionsForProject =
          needle && !projectMatches
            ? entry.sessions.filter((session) =>
                sessionTitle(session.summary).toLowerCase().includes(needle),
              )
            : entry.sessions;
        return (
          <section key={projectId} className="border-b border-muted">
            <div className="px-2 py-1">
              <ProjectButton
                entityId={projectId}
                name={entry.project.name}
                running={entry.running > 0}
                aria-expanded={open}
                onClick={() => toggle(projectId)}
              />
            </div>
            {open ? (
              <ProjectSessions
                sessions={sessionsForProject}
                activeSessionId={activeSessionId}
                revealed={needle.length > 0 || revealed.has(projectId)}
                onReveal={() =>
                  setRevealed((current) => {
                    const next = new Set(current);
                    next.add(projectId);
                    return next;
                  })
                }
                now={now}
                onOpen={(sessionId) => navigate(routes.session(sessionId))}
              />
            ) : null}
          </section>
        );
      })}
      {visibleOrphans.length > 0 ? (
        <section className="flex flex-col px-2 py-1">
          {visibleOrphans.map((entry) => (
            <ProjectButton
              key={entry.summary.session_id}
              entityId={entry.summary.session_id}
              name={sessionTitle(entry.summary)}
              variant={ProjectButtonVariant.Orphan}
              active={entry.summary.session_id === activeSessionId}
              running={isActiveRun(entry.active_run)}
              onClick={() => navigate(routes.session(entry.summary.session_id))}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function visibleGroups(
  groups: { label: string; items: ManagedSessionSummary[] }[],
  revealed: boolean,
): { label: string; items: ManagedSessionSummary[] }[] {
  if (revealed) return groups;
  let budget = PREVIEW_LIMIT;
  const shown: { label: string; items: ManagedSessionSummary[] }[] = [];
  for (const group of groups) {
    if (group.label === "Pinned") {
      shown.push(group);
      continue;
    }
    if (budget <= 0) continue;
    const items = group.items.slice(0, budget);
    budget -= items.length;
    if (items.length > 0) shown.push({ label: group.label, items });
  }
  return shown;
}

function ProjectSessions({
  sessions,
  activeSessionId,
  revealed,
  onReveal,
  now,
  onOpen,
}: {
  sessions: ManagedSessionSummary[];
  activeSessionId: string | null;
  revealed: boolean;
  onReveal: () => void;
  now: number;
  onOpen: (sessionId: string) => void;
}) {
  const sessionTitle = useSessionTitle();
  const sessionActions = useSessionActions();
  const groups = useMemo(
    () =>
      groupByRecency(
        sessions,
        (entry) => ({
          updatedAt: entry.summary.updated_at,
          pinned: Boolean(entry.summary.pinned),
        }),
        now,
      ),
    [sessions, now],
  );

  if (sessions.length === 0) {
    return <p className="label-small text-basic-muted px-4 pb-3">No chats yet</p>;
  }

  const pinnedCount = groups.find((group) => group.label === "Pinned")?.items.length ?? 0;
  const hidden = revealed ? 0 : Math.max(0, sessions.length - pinnedCount - PREVIEW_LIMIT);
  const shown = visibleGroups(groups, revealed);

  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      {shown.map((group) => (
        <div key={group.label} className="flex flex-col">
          <p className="label-micro text-basic-muted uppercase px-2 pt-2 pb-1">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((entry) => {
              const title = sessionTitle(entry.summary);
              const behavior = sessionBehaviorPresentation(entry.summary.behavior);
              return (
                <ChatSessionButton
                  key={entry.summary.session_id}
                  title={title}
                  badge={behavior.navigationLabel}
                  badgeLabel={behavior.label}
                  aria-label={`${title}, ${behavior.navigationLabel}`}
                  active={entry.summary.session_id === activeSessionId}
                  running={isActiveRun(entry.active_run)}
                  forkedFromTitle={entry.summary.forked_from?.title}
                  onClick={() => onOpen(entry.summary.session_id)}
                  actions={
                    <ChatSessionActions
                      title={title}
                      pinned={entry.summary.pinned}
                      onPin={() => void sessionActions.togglePin(entry.summary)}
                      onRename={() => sessionActions.rename(entry.summary)}
                      onDelete={() => sessionActions.remove(entry.summary)}
                    />
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
      {hidden > 0 ? (
        <TabButton onClick={onReveal}>
          <Icon iconName={IconName.MenuHorizontal} />
          <span className="text-left flex-grow">See {hidden} more</span>
        </TabButton>
      ) : null}
    </div>
  );
}
