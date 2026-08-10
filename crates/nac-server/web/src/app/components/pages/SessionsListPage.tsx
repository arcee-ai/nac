import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  StickyButton,
  StickyInput,
  StickyInputVariant,
} from "@/app/atoms";
import {
  SessionCard,
  type SessionReorderStart,
} from "@/app/components/sessions/SessionCard";
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import {
  isNoOpMove,
  pinGroup,
  targetIndexInGroup,
  type DropEdge,
} from "@/app/lib/sessionOrder";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useMoveSessionOrder, useSessions } from "@/app/services/queries";
import {
  clearAttention,
  trackAttention,
  useAttention,
} from "@/app/store/attentionStore";
import {
  setQuery,
  useFilterQuery,
  useIsDefaultSort,
  useVisibleSessions,
} from "@/app/store/sessionFiltersStore";
import type { ManagedSessionSummary } from "@/app/types/api";

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
        single
          ? "grid-cols-1"
          : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
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

interface DropTarget {
  sessionId: string;
  edge: DropEdge;
}

interface DragState {
  sessionId: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/** Wrapper so each card can subscribe to its own attention flag. */
function GridCard({
  entry,
  onOpen,
  reorderable,
  dragging,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onReorderStart,
}: {
  entry: ManagedSessionSummary;
  onOpen: (id: string) => void;
  reorderable: boolean;
  dragging: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderStart: (start: SessionReorderStart) => void;
}) {
  const actions = useSessionActions();
  const attention = useAttention(entry.summary.session_id);

  return (
    <SessionCard
      entry={entry}
      selected={false}
      attention={attention}
      onOpen={onOpen}
      onTogglePin={(e) => void actions.togglePin(e.summary)}
      onRename={(e) => actions.rename(e.summary)}
      onDelete={(e) => actions.remove(e.summary)}
      onStop={(e) => void actions.stopRun(e.summary)}
      dragging={dragging}
      reorder={
        reorderable
          ? {
              canMoveUp,
              canMoveDown,
              onMoveUp,
              onMoveDown,
              onReorderStart,
            }
          : undefined
      }
    />
  );
}

function hitTestDropTarget(
  clientX: number,
  clientY: number,
  draggingId: string,
): DropTarget | "pin-zone" | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.dataset.pinDropZone === "true") return "pin-zone";
    const card = node.closest<HTMLElement>("[data-session-id]");
    if (!card) continue;
    const sessionId = card.dataset.sessionId;
    if (!sessionId || sessionId === draggingId) continue;
    // Skip the floating ghost (fixed + data-dragging).
    if (card.dataset.dragging === "true") continue;
    const rect = card.getBoundingClientRect();
    const edge: DropEdge =
      clientX < rect.left + rect.width / 2 ? "before" : "after";
    return { sessionId, edge };
  }
  return null;
}

export default function SessionsListPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const actions = useSessionActions();
  const toast = useToast();
  const query = useFilterQuery();
  const isDefaultSort = useIsDefaultSort();
  const moveOrder = useMoveSessionOrder();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [pinZoneActive, setPinZoneActive] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const pinZoneRef = useRef(false);

  const { data, isLoading, error } = useSessions();
  const all = data ?? [];
  const sessions = useVisibleSessions(all);

  useEffect(() => {
    if (data) trackAttention(data, null);
  }, [data]);

  const openSession = (id: string) => {
    clearAttention(id);
    navigate(routes.session(id));
  };

  const pinned = sessions.filter((entry) => entry.summary.pinned);
  const unpinned = sessions.filter((entry) => !entry.summary.pinned);
  const countLabel = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;

  const fullPinned = useMemo(() => pinGroup(all, true), [all]);
  const fullUnpinned = useMemo(() => pinGroup(all, false), [all]);
  const entriesById = useMemo(() => {
    const map = new Map<string, ManagedSessionSummary>();
    for (const entry of sessions) {
      map.set(entry.summary.session_id, entry);
    }
    return map;
  }, [sessions]);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    dropTargetRef.current = null;
    pinZoneRef.current = false;
    setDrag(null);
    setDropTarget(null);
    setPinZoneActive(false);
  }, []);

  const moveTo = useCallback(
    async (
      sessionId: string,
      targetPinned: boolean,
      targetIndex: number,
    ) => {
      if (isNoOpMove(all, sessionId, targetPinned, targetIndex)) {
        clearDrag();
        return;
      }
      try {
        await moveOrder.mutateAsync({
          sessions: all,
          sessionId,
          targetPinned,
          targetIndex,
        });
      } catch (err) {
        toast.error(`Failed to reorder sessions: ${errorMessage(err)}`);
      } finally {
        clearDrag();
      }
    },
    [all, clearDrag, moveOrder, toast],
  );

  const moveByArrow = useCallback(
    (entry: ManagedSessionSummary, delta: -1 | 1) => {
      const pinnedGroup = Boolean(entry.summary.pinned);
      const group = pinnedGroup ? fullPinned : fullUnpinned;
      const index = group.findIndex(
        (e) => e.summary.session_id === entry.summary.session_id,
      );
      if (index < 0) return;
      const next = index + delta;
      if (next < 0 || next >= group.length) return;
      void moveTo(entry.summary.session_id, pinnedGroup, next);
    },
    [fullPinned, fullUnpinned, moveTo],
  );

  const applyDropTarget = useCallback(
    (dragId: string, target: DropTarget) => {
      if (target.sessionId === dragId) {
        clearDrag();
        return;
      }
      const targetEntry = entriesById.get(target.sessionId);
      if (!targetEntry) {
        clearDrag();
        return;
      }
      const targetPinned = Boolean(targetEntry.summary.pinned);
      const group = targetPinned ? fullPinned : fullUnpinned;
      const targetIndex = targetIndexInGroup(
        group,
        target.sessionId,
        target.edge,
        dragId,
      );
      void moveTo(dragId, targetPinned, targetIndex);
    },
    [clearDrag, entriesById, fullPinned, fullUnpinned, moveTo],
  );

  const beginDrag = useCallback((start: SessionReorderStart) => {
    if (!start.sessionId) return;
    const next: DragState = {
      sessionId: start.sessionId,
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

      const hit = hitTestDropTarget(e.clientX, e.clientY, current.sessionId);
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
      setDropTarget((prev) =>
        prev?.sessionId === hit.sessionId && prev.edge === hit.edge
          ? prev
          : hit,
      );
    };

    const onUp = () => {
      const current = dragRef.current;
      if (!current) {
        clearDrag();
        return;
      }
      if (pinZoneRef.current) {
        void moveTo(current.sessionId, true, 0);
        return;
      }
      const target = dropTargetRef.current;
      if (target) {
        applyDropTarget(current.sessionId, target);
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

  const renderCard = (
    entry: ManagedSessionSummary,
    group: "pinned" | "unpinned",
  ) => {
    const fullGroup = group === "pinned" ? fullPinned : fullUnpinned;
    const index = fullGroup.findIndex(
      (e) => e.summary.session_id === entry.summary.session_id,
    );
    const id = entry.summary.session_id;
    const isDragging = drag?.sessionId === id;
    const dropEdge =
      !isDragging && dropTarget?.sessionId === id ? dropTarget.edge : null;

    return (
      <Fragment key={id}>
        {dropEdge === "before" ? <DropSlot /> : null}
        <div
          data-session-card
          data-session-id={id}
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
            entry={entry}
            onOpen={openSession}
            reorderable={isDefaultSort}
            dragging={isDragging}
            canMoveUp={index > 0}
            canMoveDown={index >= 0 && index < fullGroup.length - 1}
            onMoveUp={() => moveByArrow(entry, -1)}
            onMoveDown={() => moveByArrow(entry, 1)}
            onReorderStart={beginDrag}
          />
        </div>
        {dropEdge === "after" ? <DropSlot /> : null}
      </Fragment>
    );
  };

  const newButton = (
    <Button
      variant={ButtonVariant.Primary}
      size={ButtonSize.Medium}
      content={ButtonContent.IconLeft}
      onClick={actions.launch}
    >
      <Icon iconName={IconName.Add} size={16} /> New
    </Button>
  );

  // Pinned under the bar rather than scrolling with the cards, so search and
  // filters stay in reach. The 144px of head room below clears it.
  const searchBar = (
    <div className="fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4">
      <StickyInput
        className="flex-1 min-w-0"
        variant={StickyInputVariant.Search}
        placeholder="Search sessions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        aria-label="Search sessions"
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
        sessions={all}
        showSearch={false}
        mobile
        onChange={() => setFiltersOpen(false)}
      />
    </Modal>
  );

  const rail = (
    <BoxSurface
      title={countLabel}
      headerContent={
        <div className="flex items-center gap-2 shrink-0">{newButton}</div>
      }
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <SessionFilters sessions={all} />
    </BoxSurface>
  );

  const showPinDropZone =
    isDefaultSort &&
    drag != null &&
    pinned.length === 0 &&
    !all.find((e) => e.summary.session_id === drag.sessionId)?.summary.pinned;

  return (
    <div className="flex h-full min-h-0">
      {isMobile ? null : (
        <aside className="w-[360px] shrink-0 p-2 pt-16 min-h-0">{rail}</aside>
      )}
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
            <div className="label-small text-error-primary">
              {errorMessage(error)}
            </div>
          ) : null}

          {!isLoading && sessions.length === 0 ? (
            <div className="label-small text-basic-muted text-center py-16">
              No sessions match the current filters.
            </div>
          ) : null}

          {pinned.length > 0 || showPinDropZone ? (
            <CardGrid single={isMobile}>
              {pinned.map((entry) => renderCard(entry, "pinned"))}
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
          ) : null}
          {unpinned.length > 0 ? (
            <CardGrid single={isMobile}>
              {unpinned.map((entry) => renderCard(entry, "unpinned"))}
            </CardGrid>
          ) : null}
        </div>
      </div>
    </div>
  );
}
