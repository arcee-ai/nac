import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Separator,
} from "@/app/atoms";
import { ProjectsList } from "@/app/components/projects/ProjectsList";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { projectListItems, type ProjectListItem } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useProjects, useSessions } from "@/app/services/queries";
import type { SessionSummarySnapshot } from "@/app/types/api";

/** One control of a row, at the size the popover's rows are built to. */
function RowAction({
  tooltip,
  label,
  icon,
  onClick,
  variant = ButtonVariant.Ghost,
}: {
  tooltip: string;
  /** Spoken name, which carries the row's own name so the list reads apart. */
  label: string;
  icon: IconName;
  onClick: () => void;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      variant={variant}
      size={ButtonSize.Small}
      content={ButtonContent.Icon}
      title={tooltip}
      aria-label={label}
      onClick={onClick}
    >
      <Icon iconName={icon} />
    </Button>
  );
}

function matches(
  item: ProjectListItem,
  needle: string,
  titleOf: (summary: SessionSummarySnapshot) => string,
): boolean {
  const haystack =
    item.kind === "project"
      ? `${item.entry.project.name} ${item.entry.project.cwd}`
      : `${titleOf(item.session.summary)} ${item.session.summary.cwd}`;
  return haystack.toLowerCase().includes(needle);
}

/**
 * The project list behind the trail's project button: every project plus the
 * sessions that belong to none, the open one marked.
 *
 * Rendered as the body of a popover, which is what `onClose` closes — an action
 * that opens a modal of its own closes it first, so the two do not stack.
 */
export function ProjectPopover({
  activeId,
  onClose,
}: {
  /** Open project, or the session id when an unassigned session is open. */
  activeId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const sessionActions = useSessionActions();
  const sessionTitle = useSessionTitle();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const { data: projectList } = useProjects();
  const { data: sessions = [] } = useSessions();

  const items = useMemo(
    () => projectListItems(projectList?.projects ?? [], sessions),
    [projectList, sessions],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => matches(item, needle, sessionTitle));
  }, [items, query, sessionTitle]);

  return (
    <div className={cn("flex flex-col", isMobile ? "h-[calc(70dvh)]" : "max-h-[520px]")}>
      <div className="flex flex-col gap-2 shrink-0">
        <Input
          inputSize={isMobile ? InputSize.Large : InputSize.Medium}
          leading={InputLeading.Icon}
          leadingIconName={IconName.Search}
          placeholder="Search Projects"
          aria-label="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Separator />
      </div>
      <div className="flex-1 min-h-0 overflow-auto [&>*]:shrink-0">
        <ProjectsList
          items={visible}
          activeId={activeId}
          isMobile={isMobile}
          emptyLabel={query.trim() ? "No matching projects" : "No projects yet"}
          onOpenProject={(projectId) => {
            onClose();
            navigate(routes.project(projectId));
          }}
          onOpenSession={(sessionId) => {
            onClose();
            navigate(routes.session(sessionId));
          }}
          renderActions={(item) => {
            if (item.kind === "project") {
              const { project } = item.entry;
              return (
                <>
                  <RowAction
                    tooltip={project.pinned ? "Unpin project" : "Pin project"}
                    label={`${project.pinned ? "Unpin" : "Pin"} ${project.name}`}
                    icon={project.pinned ? IconName.Unpin : IconName.Pin}
                    onClick={() => void actions.togglePin(project)}
                  />
                  <RowAction
                    tooltip="Rename project"
                    label={`Rename ${project.name}`}
                    icon={IconName.Edit}
                    onClick={() => {
                      onClose();
                      actions.rename(project);
                    }}
                  />
                  <RowAction
                    tooltip="Delete project"
                    label={`Delete ${project.name}`}
                    icon={IconName.Trash}
                    variant={ButtonVariant.GhostDestructive}
                    onClick={() => {
                      onClose();
                      actions.remove(project);
                    }}
                  />
                </>
              );
            }

            const { summary } = item.session;
            const title = sessionTitle(summary);
            return (
              <>
                <RowAction
                  tooltip="Rename chat"
                  label={`Rename ${title}`}
                  icon={IconName.Edit}
                  onClick={() => {
                    onClose();
                    sessionActions.rename(summary);
                  }}
                />
                <RowAction
                  tooltip="Delete chat"
                  label={`Delete ${title}`}
                  icon={IconName.Trash}
                  variant={ButtonVariant.GhostDestructive}
                  onClick={() => {
                    onClose();
                    sessionActions.remove(summary);
                  }}
                />
                <RowAction
                  tooltip="Assign to a project"
                  label={`Assign ${title} to a project`}
                  icon={IconName.Folders}
                  onClick={() => {
                    onClose();
                    actions.assign(summary);
                  }}
                />
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
