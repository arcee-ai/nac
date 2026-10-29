import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  ShimmerLoader,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { PanelPhoneScreen } from "@/app/components/inspector/PanelPhoneScreen";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import {
  clampPanelListWidth,
  defaultPanelListWidth,
  PANEL_LIST_DEFAULT_WIDTH,
  PANEL_LIST_MAX_RATIO,
  PANEL_LIST_MIN_WIDTH,
} from "@/app/hooks/usePanelListWidth";

/**
 * The shape every side-box panel shares: the detail of whatever is selected,
 * with a narrow list of rows in a column on its right.
 *
 * Below the desktop width there is no room for both, so the two take turns. A
 * tablet opens on the selected row and reaches the list from its header; a
 * phone opens on the list, the way its tab bar does, and a row pushes the
 * detail over it.
 */
export function PanelSplit({
  list,
  listToolbar,
  listClassName,
  listTitle,
  title,
  titleAction,
  actions,
  children,
}: {
  list: ReactNode;
  /**
   * The list's own controls, staying put while it scrolls: a bar above it on a
   * desktop, inline after the back button of a tablet's list header, and the
   * trailing pills of a phone's.
   */
  listToolbar?: ReactNode;
  /** Insets of the desktop list column, for a panel drawn with its own. */
  listClassName?: string;
  /** What the list is of, titling its screen below the desktop width. */
  listTitle?: string;
  /** Row that is open, named for the narrow header. */
  title?: ReactNode;
  /** Control belonging to the title itself, beside it rather than trailing. */
  titleAction?: ReactNode;
  /** Panel's own controls, trailing the narrow header. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { setPanelListWidth, usePanelListWidth } = useNativeRuntime().stores.panelWidth;

  const { useSidePanelList, toggleSidePanelList, showSidePanelList } =
    useNativeRuntime().stores.sessionLayoutStore;

  const storedWidth = usePanelListWidth();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const showList = useSidePanelList();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragging = useRef(false);
  const releaseDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseDrag.current?.(), []);

  // Measured before paint: an unresized list is a share of this width, and a
  // first frame at the floor would visibly jump. The container only exists in
  // the desktop split, so a change of layout measures again.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isMobile, isTablet]);

  const maxWidth =
    containerWidth > 0
      ? containerWidth * PANEL_LIST_MAX_RATIO
      : (storedWidth ?? PANEL_LIST_DEFAULT_WIDTH);
  const listWidth = clampPanelListWidth(
    storedWidth ?? defaultPanelListWidth(containerWidth),
    maxWidth,
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    releaseDrag.current?.();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = event.currentTarget;
    const cursor = container.style.cursor;
    const userSelect = container.style.userSelect;
    container.style.cursor = "col-resize";
    container.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current || moveEvent.pointerId !== event.pointerId) return;
      const rect = container.getBoundingClientRect();
      const next = rect.right - moveEvent.clientX;
      setPanelListWidth(clampPanelListWidth(next, rect.width * PANEL_LIST_MAX_RATIO));
    };

    const onUp = () => {
      dragging.current = false;
      container.style.cursor = cursor;
      container.style.userSelect = userSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }
    };

    releaseDrag.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (isMobile) {
    if (showList) {
      return (
        <PanelPhoneScreen title={listTitle} actions={listToolbar} bar>
          {/* Clear of the header above and of the tab bar over the last rows. */}
          <div className="flex flex-col flex-1 min-h-0 overflow-auto px-2 pt-16 pb-32 gap-1 [&>*]:shrink-0">
            {list}
          </div>
        </PanelPhoneScreen>
      );
    }
    return (
      <PanelPhoneScreen
        title={title ?? listTitle}
        titleAction={titleAction}
        actions={actions}
        back={{ label: "Open list", onClick: () => showSidePanelList(true) }}
      >
        {children}
      </PanelPhoneScreen>
    );
  }

  // A tablet's list is a screen of its own, so the row above the detail is what
  // leads to it, and the one above the list leads back. The detail holds the
  // same place in both layouts: crossing the breakpoint keeps it mounted, so a
  // live terminal in it is neither reattached nor unfocused.
  const listScreen = isTablet && showList;
  return (
    <div ref={containerRef} className={cn("flex flex-1 min-h-0 w-full", isTablet && "flex-col")}>
      {isTablet && !showList ? (
        <div className="flex items-center gap-[10px] h-12 pl-4 pr-2 shrink-0 border-b border-muted bg-elevation-ground">
          <span className="min-w-0 truncate header-sm text-basic-primary">{title}</span>
          {titleAction}
          <span className="flex-1" />
          {actions}
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="Open list"
            aria-expanded={false}
            onClick={toggleSidePanelList}
          >
            <Icon iconName={IconName.List} />
          </Button>
        </div>
      ) : null}
      {listScreen ? (
        <div className="flex flex-col flex-1 min-h-0 bg-elevation-ground">
          <div className="flex items-center gap-2 h-12 px-2 shrink-0 border-b border-muted bg-elevation-ground">
            <Button
              className="shrink-0"
              size={ButtonSize.Medium}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label="Close list"
              onClick={() => showSidePanelList(false)}
            >
              <Icon iconName={IconName.Left} />
            </Button>
            {listToolbar ? (
              <div className="flex min-w-0 flex-1 items-center">{listToolbar}</div>
            ) : (
              <span className="min-w-0 truncate label-small text-basic-primary">{listTitle}</span>
            )}
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 [&>*]:shrink-0">
            {list}
          </div>
        </div>
      ) : null}
      {listScreen ? null : (
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground">{children}</div>
      )}
      {isTablet ? null : (
        <div
          className="relative flex flex-col shrink-0 min-h-0 border-l border-muted bg-elevation-ground"
          style={{ width: listWidth }}
        >
          {listToolbar}
          <div
            className={cn(
              "flex flex-col flex-1 min-h-0 overflow-auto px-2 py-4 [&>*]:shrink-0",
              listClassName,
            )}
          >
            {list}
          </div>
          {/* The handle sits on the list's leading edge, so dragging or arrowing
            left widens the list. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize list panel"
            aria-valuemin={PANEL_LIST_MIN_WIDTH}
            aria-valuemax={Math.round(maxWidth)}
            aria-valuenow={listWidth}
            tabIndex={0}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none"
            onPointerDown={onPointerDown}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 24 : 8;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setPanelListWidth(clampPanelListWidth(listWidth + step, maxWidth));
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setPanelListWidth(clampPanelListWidth(listWidth - step, maxWidth));
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Row of the list column, as tall as a file list row — 28px, or the 48px touch
 * row on a phone, where a finger has none of a pointer's precision.
 */
export function PanelRow({
  label,
  active = false,
  disabled = false,
  icon,
  trailing,
  title,
  onClick,
}: {
  label: string;
  active?: boolean;
  /** Queued / not yet started rows stay visible but are not selectable. */
  disabled?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const isMobile = useIsMobile();
  return (
    <TabButton
      type="button"
      size={isMobile ? TabButtonSize.Large : TabButtonSize.Small}
      active={active}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1 min-w-0 truncate text-left">{label}</span>
      {trailing}
    </TabButton>
  );
}

/**
 * Placeholder for a panel waiting on its first payload: rows the size of the
 * ones on their way, rather than the word "Loading".
 *
 * Laid out as the split it is loading into — a taller body beside a short list
 * — so the columns and the divider are already where the rows will land, and
 * arriving data fills the panel instead of rebuilding it.
 */
export function PanelLoading({ listTitle }: { listTitle?: string }) {
  const isMobile = useIsMobile();
  return (
    <PanelSplit
      listTitle={listTitle}
      list={
        <div className="px-1">
          <ShimmerLoader rows={2} rowClassName="h-7" />
        </div>
      }
    >
      <div
        role="status"
        aria-label={`Loading ${listTitle ?? "panel"}`}
        className={cn("flex flex-1 flex-col min-h-0 overflow-hidden p-4", isMobile && "pt-18")}
      >
        <ShimmerLoader rows={3} rowClassName="h-6" />
      </div>
    </PanelSplit>
  );
}

/**
 * Placeholder for an empty or not-yet-selected panel. Given a `title` it takes
 * the design's two-line form — what is missing above why it is — in the same
 * monospace as the panel body it stands in for. On a phone it starts below the
 * screen's floating header, which a panel's body otherwise runs under.
 */
export function PanelEmpty({ title, children }: { title?: string; children: ReactNode }) {
  const isMobile = useIsMobile();
  if (title === undefined) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col min-h-0 overflow-auto p-6 label-small text-basic-muted [&>*]:shrink-0",
          isMobile && "pt-20",
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-1 flex-col min-h-0 overflow-auto p-4 code code-small [&>*]:shrink-0",
        isMobile && "pt-18",
      )}
    >
      <p className="text-basic-tertiary">{title}</p>
      <p className="text-basic-muted">{children}</p>
    </div>
  );
}
