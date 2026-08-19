import { useMemo } from "react";

import { ProjectButton, ProjectButtonVariant } from "@/app/atoms";
import { GroupLabel } from "@/app/components/projects/GroupLabel";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun } from "@/app/lib/format";
import { groupByRecency, projectListItemId, type ProjectListItem } from "@/app/lib/projects";

/** Date buckets only shift once a day, so a minute of resolution is plenty. */
const RECENCY_TICK_MS = 60_000;

interface ProjectsListProps {
  items: ProjectListItem[];
  /** Project currently open, or the session id when an orphan is open. */
  activeId?: string | null;
  onOpenProject: (projectId: string) => void;
  onOpenSession: (sessionId: string) => void;
  isMobile?: boolean;
  /** Per-row controls; the caller decides what a project and an orphan get. */
  renderActions?: (item: ProjectListItem) => React.ReactNode;
  emptyLabel?: string;
}

/**
 * Projects and unassigned sessions as one date-separated stream, with pinned
 * projects lifted into their own group at the top.
 */
export function ProjectsList({
  items,
  activeId = null,
  onOpenProject,
  onOpenSession,
  isMobile = false,
  renderActions,
  emptyLabel = "No projects",
}: ProjectsListProps) {
  const now = useNow(RECENCY_TICK_MS);
  const sessionTitle = useSessionTitle();
  const groups = useMemo(
    () =>
      groupByRecency(
        items,
        (item) =>
          item.kind === "project"
            ? { updatedAt: item.entry.updatedAt, pinned: item.entry.project.pinned }
            : { updatedAt: item.session.summary.updated_at, pinned: false },
        now,
      ),
    [items, now],
  );

  if (items.length === 0) {
    return <div className="label-small text-basic-muted px-2 py-1">{emptyLabel}</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <GroupLabel className={isMobile ? "px-3" : "px-2"}>{group.label}</GroupLabel>
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const id = projectListItemId(item);
              const actions = renderActions?.(item);
              return item.kind === "project" ? (
                <ProjectButton
                  key={id}
                  entityId={id}
                  name={item.entry.project.name}
                  active={id === activeId}
                  running={item.entry.running > 0}
                  trailing={String(item.entry.sessions.length)}
                  isMobile={isMobile}
                  actions={actions}
                  onClick={() => onOpenProject(id)}
                />
              ) : (
                <ProjectButton
                  key={id}
                  entityId={id}
                  name={sessionTitle(item.session.summary)}
                  variant={ProjectButtonVariant.Orphan}
                  active={id === activeId}
                  running={isActiveRun(item.session.active_run)}
                  isMobile={isMobile}
                  actions={actions}
                  onClick={() => onOpenSession(id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
