import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  BoxSurface,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  Separator,
  StickyButton,
  StickyInput,
  StickyInputVariant,
  Tooltip,
} from "@/app/atoms";
import { GroupLabel } from "@/app/components/projects/GroupLabel";
import {
  ProjectCard,
  type ProjectListKind,
  type ProjectReorderStart,
} from "@/app/components/projects/ProjectCard";
import { ProjectsEmptyState } from "@/app/components/projects/ProjectsEmptyState";
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { toRunError } from "@/app/lib/providerError";
import {
  orphanSessions,
  projectListItemId,
  projectListItems,
  type ProjectListItem,
} from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { NEW_PROJECT_KEYS } from "@/app/lib/shortcuts";
import { pinGroup, targetIndexInGroup, type DropEdge } from "@/app/lib/sessionOrder";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useMoveProjectOrder,
  useMoveSessionOrder,
  useProjects,
  useSessionsWithWorkspaceStats,
} from "@/app/services/queries";
import { clearAttentionAll, trackAttention, useAnyAttention } from "@/app/store/attentionStore";
import {
  setQuery,
  useFilterQuery,
  useIsDefaultSort,
  useVisibleProjectItems,
} from "@/app/store/sessionFiltersStore";
import type { ProjectRecord } from "@/app/types/api";

// Columns are 360px at minimum and stretch to fill the row, so the design's
// 3-up layout falls out naturally at the 1520px reference width and wider
// viewports gain columns instead of empty space.
function CardGrid({
  children,
  single,
}: {
  children: React.ReactNode;
  /** One card per row, which is all a phone has width for. */
  single: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        single ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
      )}
    >
      {children}
    </div>
  );
}

/** Empty insertion slot — blue outline where the card will land. */
function DropSlot() {
  return (
    <div
      aria-hidden
      className="min-h-[112px] rounded-[8px] border-2"
      style={{ borderColor: "var(--blue-500)" }}
    />
  );
}

/** Chats a card answers for: its own, or every one inside the project. */
function attentionIds(item: ProjectListItem): string[] {
  return item.kind === "project"
    ? item.entry.sessions.map((entry) => entry.summary.session_id)
    : [item.session.summary.session_id];
}

/** Pinning orders the project grid; a loose chat has no place in that order. */
function isPinned(item: ProjectListItem): boolean {
  return item.kind === "project" && item.entry.project.pinned;
}

interface DropTarget {
  itemId: string;
  edge: DropEdge;
}

interface DragState {
  itemId: string;
  kind: ProjectListKind;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/** Wrapper so each card can subscribe to its own attention flag. */
function GridCard({
  item,
  onOpen,
  reorderable,
  dragging,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onReorderStart,
}: {
  item: ProjectListItem;
  onOpen: (item: ProjectListItem) => void;
  reorderable: boolean;
  dragging: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (start: ProjectReorderStart) => void;
}) {
  const projectActions = useProjectActions();
  const sessionActions = useSessionActions();
  const attention = useAnyAttention(attentionIds(item));

  const common = {
    item,
    selected: false,
    attention,
    dragging,
    onOpen: () => onOpen(item),
    reorder: reorderable
      ? { canMoveUp, canMoveDown, onMoveUp, onMoveDown, onReorderStart }
      : undefined,
  };

  if (item.kind === "project") {
    const { project } = item.entry;
    return (
      <ProjectCard
        {...common}
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

function hitTestDropTarget(
  clientX: number,
  clientY: number,
  draggingId: string,
  draggingKind: ProjectListKind,
): DropTarget | "pin-zone" | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) continue;
    // Pinning is a project-only drop; an orphan over this zone is ignored.
    if (node.dataset.pinDropZone === "true") {
      if (draggingKind !== "project") continue;
      return "pin-zone";
    }
    const card = node.closest<HTMLElement>("[data-item-id]");
    if (!card) continue;
    const itemId = card.dataset.itemId;
    if (!itemId || itemId === draggingId) continue;
    // Projects and unassigned chats keep separate orders; a drop across
    // groups would put a card where it cannot live.
    if (card.dataset.itemKind !== draggingKind) continue;
    // Skip the floating ghost (fixed + data-dragging).
    if (card.dataset.dragging === "true") continue;
    const rect = card.getBoundingClientRect();
    const edge: DropEdge = clientX < rect.left + rect.width / 2 ? "before" : "after";
    return { itemId, edge };
  }
  return null;
}

/** Projects of one pin group, in the order the backend keeps them. */
function pinnedGroup(projects: ProjectRecord[], pinned: boolean): ProjectRecord[] {
  return projects
    .filter((project) => project.pinned === pinned)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export default function ProjectsListPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const projectActions = useProjectActions();
  const toast = useToast();
  const query = useFilterQuery();
  const isDefaultSort = useIsDefaultSort();
  const moveOrder = useMoveProjectOrder();
  const moveSessionOrder = useMoveSessionOrder();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [pinZoneActive, setPinZoneActive] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const pinZoneRef = useRef(false);

  const { data, isLoading, error, refetch } = useSessionsWithWorkspaceStats();
  const projectsQuery = useProjects();
  const allSessions = useMemo(() => data ?? [], [data]);
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  const all = useMemo(() => projectListItems(projects, allSessions), [projects, allSessions]);
  const items = useVisibleProjectItems(all);

  useEffect(() => {
    if (data) trackAttention(data, null);
  }, [data]);

  const open = (item: ProjectListItem) => {
    const id = projectListItemId(item);
    clearAttentionAll(attentionIds(item));
    navigate(item.kind === "project" ? routes.project(id) : routes.session(id));
  };

  const pinned = items.filter(isPinned);
  const unpinned = items.filter((item) => item.kind === "project" && !isPinned(item));
  const orphans = items.filter((item) => item.kind === "orphan");
  const projectCount = items.filter((item) => item.kind === "project").length;
  const countLabel = `${projectCount} ${projectCount === 1 ? "project" : "projects"}`;

  const fullPinned = useMemo(() => pinnedGroup(projects, true), [projects]);
  const fullUnpinned = useMemo(() => pinnedGroup(projects, false), [projects]);
  const fullOrphans = useMemo(() => orphanSessions(allSessions), [allSessions]);
  const fullUnpinnedSessions = useMemo(() => pinGroup(allSessions, false), [allSessions]);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    dropTargetRef.current = null;
    pinZoneRef.current = false;
    setDrag(null);
    setDropTarget(null);
    setPinZoneActive(false);
  }, []);

  const moveTo = useCallback(
    async (projectId: string, targetPinned: boolean, targetIndex: number) => {
      const group = pinnedGroup(projects, targetPinned);
      const current = group.findIndex((project) => project.project_id === projectId);
      const moving = projects.find((project) => project.project_id === projectId);
      if (moving && moving.pinned === targetPinned && current === targetIndex) {
        clearDrag();
        return;
      }
      try {
        await moveOrder.mutateAsync({
          projects,
          projectId,
          targetPinned,
          targetIndex,
        });
      } catch (err) {
        toast.error(`Failed to reorder projects: ${errorMessage(toRunError(err))}`);
      } finally {
        clearDrag();
      }
    },
    [projects, clearDrag, moveOrder, toast],
  );

  const moveOrphanTo = useCallback(
    async (sessionId: string, targetIndex: number) => {
      try {
        await moveSessionOrder.mutateAsync({
          sessions: allSessions,
          sessionId,
          targetPinned: false,
          targetIndex,
        });
      } catch (err) {
        toast.error(`Failed to reorder chats: ${errorMessage(toRunError(err))}`);
      } finally {
        clearDrag();
      }
    },
    [allSessions, clearDrag, moveSessionOrder, toast],
  );

  const moveByArrow = useCallback(
    (project: ProjectRecord, delta: -1 | 1) => {
      const group = project.pinned ? fullPinned : fullUnpinned;
      const index = group.findIndex((p) => p.project_id === project.project_id);
      if (index < 0) return;
      const next = index + delta;
      if (next < 0 || next >= group.length) return;
      void moveTo(project.project_id, project.pinned, next);
    },
    [fullPinned, fullUnpinned, moveTo],
  );

  const moveOrphanByArrow = useCallback(
    (sessionId: string, delta: -1 | 1) => {
      const index = fullOrphans.findIndex((entry) => entry.summary.session_id === sessionId);
      const neighbor = index < 0 ? undefined : fullOrphans[index + delta];
      if (!neighbor) return;
      const targetIndex = targetIndexInGroup(
        fullUnpinnedSessions,
        neighbor.summary.session_id,
        delta === -1 ? "before" : "after",
        sessionId,
      );
      void moveOrphanTo(sessionId, targetIndex);
    },
    [fullOrphans, fullUnpinnedSessions, moveOrphanTo],
  );

  const applyDropTarget = useCallback(
    (dragId: string, kind: ProjectListKind, target: DropTarget) => {
      if (kind === "orphan") {
        if (target.itemId === dragId) {
          clearDrag();
          return;
        }
        const targetIndex = targetIndexInGroup(
          fullUnpinnedSessions,
          target.itemId,
          target.edge,
          dragId,
        );
        void moveOrphanTo(dragId, targetIndex);
        return;
      }
      const targetProject = projects.find((project) => project.project_id === target.itemId);
      if (!targetProject || target.itemId === dragId) {
        clearDrag();
        return;
      }
      const group = pinnedGroup(projects, targetProject.pinned);
      const ids = group.map((project) => project.project_id).filter((id) => id !== dragId);
      const at = ids.indexOf(target.itemId);
      if (at < 0) {
        clearDrag();
        return;
      }
      void moveTo(dragId, targetProject.pinned, target.edge === "before" ? at : at + 1);
    },
    [clearDrag, fullUnpinnedSessions, moveOrphanTo, moveTo, projects],
  );

  const beginDrag = useCallback((start: ProjectReorderStart) => {
    if (!start.itemId) return;
    const next: DragState = {
      itemId: start.itemId,
      kind: start.kind,
      offsetX: start.offsetX,
      offsetY: start.offsetY,
      width: start.width,
      height: start.height,
      x: start.clientX - start.offsetX,
      y: start.clientY - start.offsetY,
    };
    dragRef.current = next;
    setDrag(next);
  }, []);

  // Pointer-driven reorder — HTML5 DnD was cancelling when the source re-rendered.
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = {
        ...current,
        x: e.clientX - current.offsetX,
        y: e.clientY - current.offsetY,
      };
      dragRef.current = next;
      setDrag(next);

      const hit = hitTestDropTarget(e.clientX, e.clientY, current.itemId, current.kind);
      if (hit === "pin-zone") {
        pinZoneRef.current = true;
        dropTargetRef.current = null;
        setPinZoneActive(true);
        setDropTarget(null);
        return;
      }
      pinZoneRef.current = false;
      setPinZoneActive(false);
      if (!hit) return;
      dropTargetRef.current = hit;
      setDropTarget((prev) => (prev?.itemId === hit.itemId && prev.edge === hit.edge ? prev : hit));
    };

    const onUp = () => {
      const current = dragRef.current;
      if (!current) {
        clearDrag();
        return;
      }
      if (pinZoneRef.current && current.kind === "project") {
        void moveTo(current.itemId, true, 0);
        return;
      }
      const target = dropTargetRef.current;
      if (target) {
        applyDropTarget(current.itemId, current.kind, target);
        return;
      }
      clearDrag();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyDropTarget, clearDrag, drag, moveTo]);

  const renderCard = (item: ProjectListItem) => {
    const id = projectListItemId(item);
    const project = item.kind === "project" ? item.entry.project : null;
    const projectGroup = project ? (project.pinned ? fullPinned : fullUnpinned) : [];
    const projectIndex = project
      ? projectGroup.findIndex((p) => p.project_id === project.project_id)
      : -1;
    const orphanIndex =
      item.kind === "orphan"
        ? fullOrphans.findIndex((entry) => entry.summary.session_id === id)
        : -1;
    const index = project ? projectIndex : orphanIndex;
    const groupLength = project ? projectGroup.length : fullOrphans.length;
    const isDragging = drag?.itemId === id;
    const dropEdge = !isDragging && dropTarget?.itemId === id ? dropTarget.edge : null;

    return (
      <Fragment key={id}>
        {dropEdge === "before" ? <DropSlot /> : null}
        <div
          data-item-id={id}
          data-item-kind={item.kind}
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
          <GridCard
            item={item}
            onOpen={open}
            reorderable={isDefaultSort}
            dragging={isDragging}
            canMoveUp={index > 0}
            canMoveDown={index >= 0 && index < groupLength - 1}
            onMoveUp={() => {
              if (project) moveByArrow(project, -1);
              else if (item.kind === "orphan") moveOrphanByArrow(id, -1);
            }}
            onMoveDown={() => {
              if (project) moveByArrow(project, 1);
              else if (item.kind === "orphan") moveOrphanByArrow(id, 1);
            }}
            onReorderStart={beginDrag}
          />
        </div>
        {dropEdge === "after" ? <DropSlot /> : null}
      </Fragment>
    );
  };

  const newButton = (
    <Tooltip
      title="New project"
      keyboardShortcuts={NEW_PROJECT_KEYS}
      position={Tooltip.Position.BottomLeft}
    >
      <Button
        variant={ButtonVariant.Primary}
        size={ButtonSize.Medium}
        content={ButtonContent.IconLeft}
        onClick={projectActions.create}
      >
        <Icon iconName={IconName.Add} size={16} /> New
      </Button>
    </Tooltip>
  );

  // Pinned under the bar rather than scrolling with the cards, so search and
  // filters stay in reach. The 144px of head room below clears it.
  const searchBar = (
    <div className="fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4">
      <StickyInput
        className="flex-1 min-w-0"
        variant={StickyInputVariant.Search}
        placeholder="Search projects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        aria-label="Search projects"
      />
      <StickyButton
        variant={ButtonVariant.Secondary}
        content={ButtonContent.Icon}
        aria-label="Filters"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen(true)}
      >
        <Icon iconName={IconName.Controls} />
      </StickyButton>
    </div>
  );

  // The phone puts the filters behind the full-screen dialog and dismisses it
  // as soon as one moves, so the results are visible without a second tap.
  const filtersDialog = (
    <Modal
      open={filtersOpen}
      onClose={() => setFiltersOpen(false)}
      title="Filters"
      bodyClassName="p-0"
    >
      <SessionFilters
        sessions={allSessions}
        showSearch={false}
        mobile
        onChange={() => setFiltersOpen(false)}
      />
    </Modal>
  );

  const rail = (
    <BoxSurface
      title={countLabel}
      headerContent={<div className="flex items-center gap-2 shrink-0">{newButton}</div>}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <SessionFilters sessions={allSessions} />
    </BoxSurface>
  );

  if (!isLoading && !error && all.length === 0) {
    return <ProjectsEmptyState mobile={isMobile} onStart={projectActions.create} />;
  }

  const showPinDropZone =
    isDefaultSort &&
    drag != null &&
    drag.kind === "project" &&
    pinned.length === 0 &&
    !projects.find((project) => project.project_id === drag.itemId)?.pinned;

  return (
    <div className="flex h-full min-h-0">
      {isMobile ? null : <aside className="w-[360px] shrink-0 p-2 pt-16 min-h-0">{rail}</aside>}
      {isMobile ? searchBar : null}
      {isMobile ? filtersDialog : null}

      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto",
          isMobile ? "px-2" : "px-4",
          drag && "select-none cursor-grabbing",
        )}
      >
        <div
          className={cn(
            "flex flex-col gap-6 [&>*]:shrink-0",
            isMobile ? "pt-36 pb-8" : "pt-16 pb-2",
          )}
        >
          {error ? (
            <div className="flex items-center gap-2 label-small text-error-primary">
              <span>{errorMessage(error)}</span>
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Small}
                content={ButtonContent.Text}
                onClick={() => {
                  void refetch();
                }}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {!isLoading && !error && items.length === 0 ? (
            <div className="label-small text-basic-muted text-center py-16">
              No projects match the current filters.
            </div>
          ) : null}

          {pinned.length > 0 || showPinDropZone ? (
            <>
              <CardGrid single={isMobile}>
                {pinned.map(renderCard)}
                {showPinDropZone ? (
                  <div
                    data-pin-drop-zone="true"
                    className={cn(
                      "min-h-[112px] rounded-[8px] border-2 border-dashed",
                      pinZoneActive && "bg-info-primary/10",
                    )}
                    style={{ borderColor: "var(--blue-500)" }}
                  />
                ) : null}
              </CardGrid>
              <Separator />
            </>
          ) : null}
          {unpinned.length > 0 ? (
            <CardGrid single={isMobile}>{unpinned.map(renderCard)}</CardGrid>
          ) : null}
          {/* Only the loose chats are announced: the projects above them are
              what the page is, and pinning is already legible from the cards. */}
          {orphans.length > 0 ? (
            <>
              <GroupLabel>Unassigned chat sessions</GroupLabel>
              <CardGrid single={isMobile}>{orphans.map(renderCard)}</CardGrid>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
