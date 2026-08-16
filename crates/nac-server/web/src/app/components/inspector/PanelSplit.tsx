import {
  useEffect,
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
  Modal,
  ShimmerLoader,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import {
  clampPanelListWidth,
  PANEL_LIST_MAX_RATIO,
  PANEL_LIST_MIN_WIDTH,
  setPanelListWidth,
  usePanelListWidth,
} from "@/app/hooks/usePanelListWidth";
import {
  showSidePanelList,
  toggleSidePanelList,
  useSidePanelList,
} from "@/app/store/sessionLayoutStore";

/**
 * The shape all three side-box panels share: a narrow list of rows on the left
 * and the detail of whatever is selected on the right.
 *
 * Below the desktop width there is no room for both, so the panel opens on the
 * row it has selected and the list is reached from a control of its own: a
 * dialog over the detail on a phone, the panel's own column on a tablet.
 */
export function PanelSplit({
  list,
  listToolbar,
  listTitle,
  title,
  titleAction,
  actions,
  children,
}: {
  list: ReactNode;
  /**
   * The list's own controls, staying put while it scrolls: a bar above it on a
   * pointer, and a pill floating over its last rows on a phone.
   */
  listToolbar?: ReactNode;
  /** What the list is of, for the header of the phone's list dialog. */
  listTitle?: string;
  /** Row that is open, named for the narrow header. */
  title?: string;
  /** Control belonging to the title itself, beside it rather than trailing. */
  titleAction?: ReactNode;
  /** Panel's own controls, trailing the narrow header. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const storedWidth = usePanelListWidth();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const showList = useSidePanelList();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const maxWidth = containerWidth > 0 ? containerWidth * PANEL_LIST_MAX_RATIO : storedWidth;
  const listWidth = clampPanelListWidth(storedWidth, maxWidth);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return;
      const rect = container.getBoundingClientRect();
      const next = moveEvent.clientX - rect.left;
      setPanelListWidth(clampPanelListWidth(next, rect.width * PANEL_LIST_MAX_RATIO));
    };

    const onUp = (upEvent: PointerEvent) => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Already released.
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (isMobile) {
    // The phone's outer dialog already shows the selected row; the list is a
    // second dialog stacked on top of it.
    return (
      <>
        <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5">
          {children}
        </div>
        <Modal
          open={showList}
          onClose={() => showSidePanelList(false)}
          title={listTitle}
          keepOnNavigate
          bodyClassName="!p-0 relative flex flex-col overflow-hidden"
        >
          <div
            className={cn(
              "flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 gap-1 [&>*]:shrink-0",
              // Clearance for the bar floating over the last rows.
              listToolbar && "pb-[80px]",
            )}
          >
            {list}
          </div>
          {listToolbar ? (
            <div className="absolute inset-x-0 bottom-0 z-10 p-4 pointer-events-none [&>*]:pointer-events-auto">
              {listToolbar}
            </div>
          ) : null}
        </Modal>
      </>
    );
  }

  if (isTablet) {
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full">
        {/* The list is a screen of its own here, so the row above the detail is
            what leads back to it. */}
        {!showList ? (
          <div className="flex items-center gap-[10px] h-12 px-2 shrink-0 border-b border-muted bg-elevation-level-1">
            <span className="min-w-0 truncate label-small text-basic-primary">{title}</span>
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
        {showList ? (
          <div className="flex flex-col flex-1 min-h-0 bg-elevation-level-1">
            {listToolbar}
            <div className="flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-1 [&>*]:shrink-0">
              {list}
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5">
            {children}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 w-full">
      <div
        className="relative flex flex-col shrink-0 min-h-0 border-r border-muted bg-elevation-level-1"
        style={{ width: listWidth }}
      >
        {listToolbar}
        <div className="flex flex-col flex-1 min-h-0 overflow-auto pt-4 px-1 [&>*]:shrink-0">
          {list}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize list panel"
          aria-valuemin={PANEL_LIST_MIN_WIDTH}
          aria-valuemax={Math.round(maxWidth)}
          aria-valuenow={listWidth}
          tabIndex={0}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none"
          onPointerDown={onPointerDown}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setPanelListWidth(clampPanelListWidth(listWidth - step, maxWidth));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setPanelListWidth(clampPanelListWidth(listWidth + step, maxWidth));
            }
          }}
        />
      </div>
      <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5">{children}</div>
    </div>
  );
}

/**
 * Row of the left list, sized to the 24px tree row in the design — and to the
 * 48px touch row on a phone, where a finger has none of a pointer's precision.
 */
export function PanelRow({
  label,
  active = false,
  disabled = false,
  icon,
  trailing,
  labelClassName,
  title,
  onClick,
}: {
  label: string;
  active?: boolean;
  /** Queued / not yet started rows stay visible but are not selectable. */
  disabled?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** Overrides the label colour, e.g. to mark a file's git status. */
  labelClassName?: string;
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
      <span className={cn("flex-1 min-w-0 truncate text-left", labelClassName)}>{label}</span>
      {trailing}
    </TabButton>
  );
}

/**
 * Placeholder for a panel waiting on its first payload: rows the size of the
 * ones on their way, rather than the word "Loading".
 *
 * Laid out as the split it is loading into — a short list beside a taller body
 * — so the columns and the divider are already where the rows will land, and
 * arriving data fills the panel instead of rebuilding it.
 */
export function PanelLoading({ listTitle }: { listTitle?: string }) {
  return (
    <PanelSplit
      listTitle={listTitle}
      list={
        <div className="px-1">
          <ShimmerLoader rows={2} rowClassName="h-6" />
        </div>
      }
    >
      <div
        role="status"
        aria-label={`Loading ${listTitle ?? "panel"}`}
        className="flex flex-1 flex-col min-h-0 overflow-hidden p-4"
      >
        <ShimmerLoader rows={3} rowClassName="h-6" />
      </div>
    </PanelSplit>
  );
}

/**
 * Placeholder for an empty or not-yet-selected panel. Given a `title` it takes
 * the design's two-line form — what is missing above why it is — in the same
 * monospace as the panel body it stands in for.
 */
export function PanelEmpty({ title, children }: { title?: string; children: ReactNode }) {
  if (title === undefined) {
    return (
      <div className="flex flex-1 flex-col min-h-0 overflow-auto p-6 label-small text-basic-muted [&>*]:shrink-0">
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-auto p-4 code code-small [&>*]:shrink-0">
      <p className="text-basic-tertiary">{title}</p>
      <p className="text-basic-muted">{children}</p>
    </div>
  );
}
