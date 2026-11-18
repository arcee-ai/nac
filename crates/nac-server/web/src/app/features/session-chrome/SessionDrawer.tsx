import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Drawer,
  Icon,
  IconName,
} from "@/app/atoms";
import { SessionSideBox } from "@/app/components/inspector/SessionSideBox";
import { GoalPanel } from "@/app/features/session-chrome/GoalPanel";
import { useSessionDrawer } from "@/app/features/session-chrome/useSessionDrawer";
import { CHAT_MIN_WIDTH, DOCK_DEFAULT_WIDTH, DOCK_MIN_WIDTH } from "@/app/hooks/useDockWidth";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { useIsMobile, useMediaQuery } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { SESSION_PANEL_LABEL, type SessionPanel } from "@/app/lib/routes";
import { DOCK_DRAWER_KEYS } from "@/app/lib/shortcuts";
import { PanelPhoneChromeProvider } from "@/app/providers/PanelPhoneChrome";
import type { SessionBehavior, SessionSnapshotResponse } from "@/app/types/api";

/** Docking needs room for a readable chat (≥460px) beside the 560px column and sidebar. */
const DOCK_QUERY = "(min-width: 1280px)";

/** Kept in step with the width transition below. */
const DOCK_MS = 200;

/**
 * Mounts the docked column with a width tween, and keeps it mounted through
 * its exit so closing slides it away instead of snapping the chat wide.
 */
function useDockPresence(docked: boolean) {
  const [mounted, setMounted] = useState(docked);
  const [shown, setShown] = useState(false);
  const [was, setWas] = useState(docked);
  if (was !== docked) {
    setWas(docked);
    if (docked) setMounted(true);
    else setShown(false);
  }
  useEffect(() => {
    if (!docked || !mounted) return undefined;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [docked, mounted]);
  useEffect(() => {
    if (docked || !mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), DOCK_MS);
    return () => clearTimeout(timer);
  }, [docked, mounted]);
  return { mounted, shown };
}

function GoalHeader({
  pinned,
  onTogglePinned,
  onClose,
}: {
  pinned: boolean;
  onTogglePinned?: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-muted pr-2 pl-5">
      <h2 className="type-strong min-w-0 flex-1 truncate text-basic-primary">Goal</h2>
      {onTogglePinned ? (
        <Button
          size={ButtonSize.Medium}
          variant={pinned ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          aria-label={pinned ? "Float drawer" : "Dock drawer"}
          aria-pressed={pinned}
          title="Dock or float (⌘\)"
          onClick={onTogglePinned}
        >
          <Icon iconName={IconName.ShowSidePanel} />
        </Button>
      ) : null}
      <Button
        size={ButtonSize.Medium}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Hide panel"
        onClick={onClose}
      >
        <Icon iconName={IconName.Close} />
      </Button>
    </header>
  );
}

/**
 * The session's one secondary surface. Floating, it is the shared `Drawer`:
 * 560px from the right, or a bottom sheet on a phone.
 * Docked (⌘\), it is a column laid out beside the chat column, never inside
 * it. The route's panel picks what it shows; the goal has a drawer of its own.
 */
export function SessionDrawer({
  sessionId,
  snapshot,
  behavior,
  panel,
  goalEnabled,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  behavior: SessionBehavior | null;
  /** The route's panel after the behavior policy corrected it. */
  panel: SessionPanel;
  /** Whether this session can carry a goal (a direct, non-delegated agent). */
  goalEnabled: boolean;
}) {
  const drawer = useSessionDrawer(sessionId, panel);
  const isMobile = useIsMobile();
  const wideViewport = useMediaQuery(DOCK_QUERY) && !isMobile;
  const { useDockWidth, setDockWidth } = useNativeRuntime().stores.dockWidth;
  const preferredWidth = useDockWidth();
  const measureRef = useRef<HTMLSpanElement>(null);
  const cleanupDrag = useRef<(() => void) | null>(null);
  const [availableWidth, setAvailableWidth] = useState(DOCK_MIN_WIDTH + CHAT_MIN_WIDTH);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => cleanupDrag.current?.(), []);
  useLayoutEffect(() => {
    const parent = measureRef.current?.parentElement;
    if (!parent) return undefined;
    if (typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setAvailableWidth(parent.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  // Without container observation, a host can shrink without a window resize.
  // Keep the floating fallback rather than risk an unusable split.
  const canDock =
    typeof ResizeObserver !== "undefined" &&
    wideViewport &&
    availableWidth >= DOCK_MIN_WIDTH + CHAT_MIN_WIDTH;
  const docked = drawer.open && drawer.pinned && canDock;
  const presence = useDockPresence(docked);
  const maxWidth = Math.max(DOCK_MIN_WIDTH, availableWidth - CHAT_MIN_WIDTH);
  const width = Math.min(preferredWidth, maxWidth);
  const panelWidth = drawer.expanded && availableWidth ? availableWidth : width;
  const resize = (next: number) => setDockWidth(Math.min(maxWidth, Math.max(DOCK_MIN_WIDTH, next)));
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupDrag.current?.();
    const startX = event.clientX;
    const startWidth = width;
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    handle.setPointerCapture(pointerId);
    setDragging(true);
    const move = (next: PointerEvent) => {
      if (next.pointerId === pointerId) resize(startWidth + startX - next.clientX);
    };
    const stop = (next?: PointerEvent) => {
      if (next && next.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* Already released. */
      }
      cleanupDrag.current = null;
      setDragging(false);
    };
    cleanupDrag.current = () => stop();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const goal = drawer.content === "goal" && goalEnabled;

  useKeyboardShortcuts([
    { keys: DOCK_DRAWER_KEYS, onTrigger: drawer.togglePinned, enabled: canDock },
  ]);

  const onTogglePinned = canDock ? drawer.togglePinned : undefined;
  const body = (pinned: boolean): ReactNode =>
    goal ? (
      <div className="flex min-h-0 flex-1 flex-col">
        {isMobile ? null : (
          <GoalHeader pinned={pinned} onTogglePinned={onTogglePinned} onClose={drawer.close} />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GoalPanel sessionId={sessionId} enabled={goalEnabled} />
        </div>
      </div>
    ) : (
      <SessionSideBox
        sessionId={sessionId}
        snapshot={snapshot}
        behavior={behavior}
        panel={panel}
        onPanelChange={drawer.openPanel}
        onClose={drawer.close}
        pinned={pinned}
        onTogglePinned={onTogglePinned}
      />
    );

  const title = goal ? "Goal" : SESSION_PANEL_LABEL[panel];

  return (
    <>
      <span ref={measureRef} aria-hidden="true" className="absolute hidden" />
      {presence.mounted ? (
        <aside
          aria-label={title}
          aria-hidden={!docked || undefined}
          inert={!docked}
          className={cn(
            "relative h-full shrink-0 overflow-hidden border-l border-tertiary bg-elevation-ground",
            !dragging &&
              "transition-[width] duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none",
          )}
          style={{ width: presence.shown ? panelWidth : 0 }}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing)
              return;
            if (event.target instanceof Element && event.target.closest(".xterm")) return;
            event.preventDefault();
            if (drawer.expanded) drawer.toggleExpanded();
            else drawer.close();
          }}
        >
          {/* Fixed width inside the tween, so the panel slides rather than reflows. */}
          <div
            className="absolute inset-y-0 left-0 flex flex-col"
            style={{ width: panelWidth || DOCK_DEFAULT_WIDTH }}
          >
            {body(true)}
          </div>
          {!drawer.expanded && docked ? (
            <div
              role="separator"
              aria-label="Resize session panel"
              aria-orientation="vertical"
              aria-valuemin={DOCK_MIN_WIDTH}
              aria-valuemax={maxWidth}
              aria-valuenow={width}
              tabIndex={0}
              title="Resize session panel"
              className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize touch-none hover:bg-basic-primary/10 focus-visible:bg-basic-primary/10 focus-visible:outline focus-visible:outline-2"
              onPointerDown={onResizeStart}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 50 : 10;
                if (event.key === "ArrowLeft") resize(width + step);
                else if (event.key === "ArrowRight") resize(width - step);
                else if (event.key === "Home") resize(DOCK_MIN_WIDTH);
                else if (event.key === "End") resize(maxWidth);
                else return;
                event.preventDefault();
              }}
            >
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-1 h-8 w-1 -translate-y-1/2 rounded-full bg-basic-tertiary"
              />
            </div>
          ) : null}
        </aside>
      ) : null}
      <Drawer
        open={drawer.open && !docked}
        onClose={drawer.close}
        onEscape={(event) => {
          if (event.target instanceof Element && event.target.closest(".xterm")) return;
          if (!isMobile && drawer.expanded) drawer.toggleExpanded();
          else drawer.close();
        }}
        title={title}
        bare
        expanded={drawer.expanded}
        className={isMobile ? "h-[92dvh] bg-elevation-ground" : undefined}
        bodyClassName="overflow-hidden"
      >
        {isMobile ? (
          <PanelPhoneChromeProvider value={{ close: drawer.close, bar: null }}>
            {goal ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-12 shrink-0 items-center justify-between pr-1 pl-5">
                  <h2 className="type-heading text-basic-primary">Goal</h2>
                  <Button
                    size={ButtonSize.Large}
                    variant={ButtonVariant.Ghost}
                    content={ButtonContent.Icon}
                    aria-label="Hide panel"
                    onClick={drawer.close}
                  >
                    <Icon iconName={IconName.Close} />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <GoalPanel sessionId={sessionId} enabled={goalEnabled} />
                </div>
              </div>
            ) : (
              body(false)
            )}
          </PanelPhoneChromeProvider>
        ) : (
          body(false)
        )}
      </Drawer>
    </>
  );
}
