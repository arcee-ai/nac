import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectListKind, ProjectReorderStart } from "@/app/components/projects/ProjectCard";
import { toRunError } from "@/app/lib/providerError";
import { orphanSessions, projectForSessionLocation } from "@/app/lib/projects";
import { pinGroup, targetIndexInGroup, type DropEdge } from "@/app/lib/sessionOrder";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useMoveProjectOrder, useMoveSessionOrder } from "@/app/services/queries";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

export interface DropTarget {
  itemId: string;
  edge: DropEdge;
}

export interface DragState {
  itemId: string;
  kind: ProjectListKind;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/** Projects of one pin group, in the order the backend keeps them. */
export function pinnedGroup(projects: readonly ProjectRecord[], pinned: boolean): ProjectRecord[] {
  return projects
    .filter((project) => project.pinned === pinned)
    .sort((a, b) => a.sort_order - b.sort_order);
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
    // Skip the floating ghost (fixed + data-dragging).
    if (card.dataset.dragging === "true") continue;
    const rect = card.getBoundingClientRect();
    const edge: DropEdge = clientX < rect.left + rect.width / 2 ? "before" : "after";
    // An unassigned session can land on a project to be assigned.
    if (draggingKind === "orphan" && card.dataset.itemKind === "project") {
      return { itemId, edge };
    }
    // Projects and unassigned sessions keep separate orders.
    if (card.dataset.itemKind !== draggingKind) continue;
    return { itemId, edge };
  }
  return null;
}

/**
 * Pointer-driven reorder of Home's project tiles (HTML5 DnD cancelled when the
 * source re-rendered), plus keyboard/arrow moves, pin-by-drop and
 * drop-to-assign for unassigned sessions. Same commands as before: the
 * project/session order mutations and the project assign action.
 */
export function useProjectReorder(
  projects: readonly ProjectRecord[],
  sessions: readonly ManagedSessionSummary[],
) {
  const projectActions = useProjectActions();
  const toast = useToast();
  const moveOrder = useMoveProjectOrder();
  const moveSessionOrder = useMoveSessionOrder();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [pinZoneActive, setPinZoneActive] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const pinZoneRef = useRef(false);

  const fullPinned = useMemo(() => pinnedGroup(projects, true), [projects]);
  const fullUnpinned = useMemo(() => pinnedGroup(projects, false), [projects]);
  const fullOrphans = useMemo(() => orphanSessions([...sessions]), [sessions]);
  const fullUnpinnedSessions = useMemo(() => pinGroup([...sessions], false), [sessions]);

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
          projects: [...projects],
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
          sessions: [...sessions],
          sessionId,
          targetPinned: false,
          targetIndex,
        });
      } catch (err) {
        toast.error(`Failed to reorder sessions: ${errorMessage(toRunError(err))}`);
      } finally {
        clearDrag();
      }
    },
    [sessions, clearDrag, moveSessionOrder, toast],
  );

  const assignOrphanToProject = useCallback(
    (sessionId: string, projectId: string) => {
      const entry = sessions.find((session) => session.summary.session_id === sessionId);
      const project = projects.find((item) => item.project_id === projectId);
      try {
        if (!entry || !project) return;
        const covering = projectForSessionLocation([...projects], entry.summary);
        if (covering?.project_id !== project.project_id) {
          toast.error("That session does not run in this project's location");
          return;
        }
        projectActions.assign(entry.summary);
      } finally {
        clearDrag();
      }
    },
    [sessions, clearDrag, projectActions, projects, toast],
  );

  const moveByArrow = useCallback(
    (project: ProjectRecord, delta: -1 | 1) => {
      const group = project.pinned ? fullPinned : fullUnpinned;
      const index = group.findIndex((p) => p.project_id === project.project_id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= group.length) return;
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
      const targetProject = projects.find((project) => project.project_id === target.itemId);
      if (kind === "orphan") {
        if (targetProject) {
          assignOrphanToProject(dragId, targetProject.project_id);
          return;
        }
        if (target.itemId === dragId) {
          clearDrag();
          return;
        }
        void moveOrphanTo(
          dragId,
          targetIndexInGroup(fullUnpinnedSessions, target.itemId, target.edge, dragId),
        );
        return;
      }
      if (!targetProject || target.itemId === dragId) {
        clearDrag();
        return;
      }
      const ids = pinnedGroup(projects, targetProject.pinned)
        .map((project) => project.project_id)
        .filter((id) => id !== dragId);
      const at = ids.indexOf(target.itemId);
      if (at < 0) {
        clearDrag();
        return;
      }
      void moveTo(dragId, targetProject.pinned, target.edge === "before" ? at : at + 1);
    },
    [assignOrphanToProject, clearDrag, fullUnpinnedSessions, moveOrphanTo, moveTo, projects],
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

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = { ...current, x: e.clientX - current.offsetX, y: e.clientY - current.offsetY };
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

  return {
    drag,
    dropTarget,
    pinZoneActive,
    beginDrag,
    moveByArrow,
    moveOrphanByArrow,
    fullPinned,
    fullUnpinned,
    fullOrphans,
  };
}
