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
import { cn } from "@/app/lib/cn";
import { displaySessionTitle } from "@/app/lib/format";
import { projectListItems, type ProjectListItem } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useProjects, useSessions } from "@/app/services/queries";

function matches(item: ProjectListItem, needle: string): boolean {
  const haystack =
    item.kind === "project"
      ? `${item.entry.project.name} ${item.entry.project.cwd}`
      : `${displaySessionTitle(item.session.summary)} ${item.session.summary.cwd}`;
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
    return items.filter((item) => matches(item, needle));
  }, [items, query]);

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
        <Button
          size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
          className="w-full justify-start"
          onClick={() => {
            onClose();
            actions.create();
          }}
        >
          <Icon iconName={IconName.Add} className="shrink-0" />
          <span className="flex-1 min-w-0 truncate text-left">New project</span>
        </Button>
        <Separator />
      </div>
      <div className="flex-1 min-h-0 overflow-auto [&>*]:shrink-0 pt-1">
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
          renderActions={(item) =>
            item.kind === "project" ? (
              <>
                <Button
                  variant={ButtonVariant.Ghost}
                  size={ButtonSize.Small}
                  content={ButtonContent.Icon}
                  title={item.entry.project.pinned ? "Unpin project" : "Pin project"}
                  aria-label={`${item.entry.project.pinned ? "Unpin" : "Pin"} ${item.entry.project.name}`}
                  onClick={() => void actions.togglePin(item.entry.project)}
                >
                  <Icon iconName={item.entry.project.pinned ? IconName.Unpin : IconName.Pin} />
                </Button>
                <Button
                  variant={ButtonVariant.GhostDestructive}
                  size={ButtonSize.Small}
                  content={ButtonContent.Icon}
                  title="Delete project"
                  aria-label={`Delete ${item.entry.project.name}`}
                  onClick={() => {
                    onClose();
                    actions.remove(item.entry.project);
                  }}
                >
                  <Icon iconName={IconName.Trash} />
                </Button>
              </>
            ) : (
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Small}
                content={ButtonContent.Icon}
                title="Assign to a project"
                aria-label={`Assign ${displaySessionTitle(item.session.summary)} to a project`}
                onClick={() => {
                  onClose();
                  actions.assign(item.session.summary);
                }}
              >
                <Icon iconName={IconName.Folders} />
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}
