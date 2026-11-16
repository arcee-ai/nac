import { Fragment } from "react";
import { useNavigate } from "react-router-dom";

import { ProjectCard, type ProjectReorderStart } from "@/app/components/projects/ProjectCard";
import { cn } from "@/app/lib/cn";
import { projectListItemId, type ProjectListItem } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

import { SectionHeading } from "./HomeSections";
import { useProjectReorder } from "./useProjectReorder";

/** Sessions a tile answers for: its own, or every one inside the project. */
function attentionIds(item: ProjectListItem): string[] {
  return item.kind === "project"
    ? item.entry.sessions.map((entry) => entry.summary.session_id)
    : [item.session.summary.session_id];
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-2">
      {children}
    </div>
  );
}

/** Where a dragged tile will land. */
function DropSlot() {
  return (
    <div
      aria-hidden
      className="min-h-[88px] rounded-card border-2 border-dashed border-[var(--f-line-strong)]"
    />
  );
}

function Tile({
  item,
  dragging,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onReorderStart,
}: {
  item: ProjectListItem;
  dragging: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (start: ProjectReorderStart) => void;
}) {
  const { useAnyAttention, clearAttentionAll } = useNativeRuntime().stores.attentionStore;
  const projectActions = useProjectActions();
  const sessionActions = useSessionActions();
  const navigate = useNavigate();
  const ids = attentionIds(item);
  const attention = useAnyAttention(ids);
  const open = () => {
    clearAttentionAll(ids);
    const id = projectListItemId(item);
    navigate(item.kind === "project" ? routes.project(id) : routes.session(id));
  };
  const common = {
    item,
    selected: false,
    attention,
    dragging,
    onOpen: open,
    reorder: { canMoveUp, canMoveDown, onMoveUp, onMoveDown, onReorderStart },
  };
  if (item.kind === "project") {
    const { project } = item.entry;
    return (
      <ProjectCard
        {...common}
        onNewSession={() => void projectActions.newChat(project.project_id)}
        onIntervalTasks={() => navigate(routes.taskSchedules(project.project_id))}
        onTogglePin={() => void projectActions.togglePin(project)}
        onRename={() => projectActions.rename(project)}
        onDelete={() => projectActions.remove(project)}
      />
    );
  }
  const { summary } = item.session;
  return (
    <ProjectCard
      {...common}
      onRename={() => sessionActions.rename(summary)}
      onDelete={() => sessionActions.remove(summary)}
      onAssign={() => projectActions.assign(summary)}
    />
  );
}

/**
 * Home's project tiles (and loose sessions), reorderable by drag, by the
 * tile's move controls, and droppable onto the pin zone.
 */
export function ProjectTiles({
  items,
  projects,
  sessions,
  headingTrailing,
}: {
  items: readonly ProjectListItem[];
  projects: readonly ProjectRecord[];
  sessions: readonly ManagedSessionSummary[];
  headingTrailing?: React.ReactNode;
}) {
  const reorder = useProjectReorder(projects, sessions);
  const { drag, dropTarget, pinZoneActive } = reorder;
  const pinned = items.filter((item) => item.kind === "project" && item.entry.project.pinned);
  const unpinned = items.filter((item) => item.kind === "project" && !item.entry.project.pinned);
  const orphans = items.filter((item) => item.kind === "orphan");
  const showPinDropZone =
    drag?.kind === "project" &&
    pinned.length === 0 &&
    !projects.find((project) => project.project_id === drag.itemId)?.pinned;

  const renderTile = (item: ProjectListItem) => {
    const id = projectListItemId(item);
    const project = item.kind === "project" ? item.entry.project : null;
    const group = project ? (project.pinned ? reorder.fullPinned : reorder.fullUnpinned) : [];
    const index = project
      ? group.findIndex((entry) => entry.project_id === project.project_id)
      : reorder.fullOrphans.findIndex((entry) => entry.summary.session_id === id);
    const length = project ? group.length : reorder.fullOrphans.length;
    const isDragging = drag?.itemId === id;
    const edge = !isDragging && dropTarget?.itemId === id ? dropTarget.edge : null;
    return (
      <Fragment key={id}>
        {edge === "before" ? <DropSlot /> : null}
        <div
          data-dragging={isDragging ? "true" : undefined}
          className="relative"
          style={
            isDragging && drag
              ? {
                  position: "fixed",
                  left: drag.x,
                  top: drag.y,
                  width: drag.width,
                  zIndex: 50,
                  pointerEvents: "none",
                  margin: 0,
                }
              : undefined
          }
        >
          <Tile
            item={item}
            dragging={isDragging}
            canMoveUp={index > 0}
            canMoveDown={index >= 0 && index < length - 1}
            onMoveUp={() =>
              project ? reorder.moveByArrow(project, -1) : reorder.moveOrphanByArrow(id, -1)
            }
            onMoveDown={() =>
              project ? reorder.moveByArrow(project, 1) : reorder.moveOrphanByArrow(id, 1)
            }
            onReorderStart={reorder.beginDrag}
          />
        </div>
        {edge === "after" ? <DropSlot /> : null}
      </Fragment>
    );
  };

  return (
    <div className={cn("flex flex-col gap-3", drag && "cursor-grabbing select-none")}>
      <section aria-label="Projects" className="flex flex-col gap-2">
        <SectionHeading trailing={headingTrailing}>Projects</SectionHeading>
        {pinned.length > 0 || showPinDropZone ? (
          <TileGrid>
            {pinned.map(renderTile)}
            {showPinDropZone ? (
              <div
                data-pin-drop-zone="true"
                className={cn(
                  "flex min-h-[88px] items-center justify-center rounded-card border-2 border-dashed border-[var(--f-line-strong)]",
                  "type-meta text-basic-tertiary",
                  pinZoneActive && "bg-[var(--f-wash-2)] text-basic-primary",
                )}
              >
                Drop to pin
              </div>
            ) : null}
          </TileGrid>
        ) : null}
        {unpinned.length > 0 ? <TileGrid>{unpinned.map(renderTile)}</TileGrid> : null}
      </section>
      {orphans.length > 0 ? (
        <section aria-label="Unassigned sessions" className="flex flex-col gap-2">
          <SectionHeading>Unassigned sessions</SectionHeading>
          <TileGrid>{orphans.map(renderTile)}</TileGrid>
        </section>
      ) : null}
    </div>
  );
}
