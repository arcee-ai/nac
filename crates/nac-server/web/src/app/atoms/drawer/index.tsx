import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/cn";
import { Sheet, SheetContent, SheetOverlay, SheetPortal, SheetTitle } from "../../ui/sheet";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

/** Kept in step with the CSS transition below. */
const EXIT_MS = 200;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name and visible heading. */
  title: React.ReactNode;
  /** Plain-text name when `title` is not a string. */
  label?: string;
  /** Controls trailing the title (filters, scope toggles). */
  headerActions?: React.ReactNode;
  /** Desktop only: the drawer fills the window instead of its 560px column. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Desktop only: dock the drawer as a side column (⌘\). */
  onPin?: () => void;
  /** Hide the built-in header for content that heads itself. */
  bare?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

/**
 * Focus's one secondary surface: a sheet from the right on desktop and from
 * the bottom on phones. It floats over the conversation with a whisper of a
 * scrim, keeps global shortcuts live (layer "sheet"), and returns focus where
 * it came from through the shared layer stack.
 */
export default function Drawer({
  open,
  onClose,
  title,
  label,
  headerActions,
  expanded = false,
  onToggleExpanded,
  onPin,
  bare = false,
  className,
  bodyClassName,
  children,
}: DrawerProps) {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setMounted(true);
    else setShown(false);
  }

  useEffect(() => {
    if (!open || !mounted) return undefined;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (open || !mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  if (!mounted) return null;
  const name = label ?? (typeof title === "string" ? title : undefined);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPortal forceMount>
        <SheetOverlay
          className={cn(
            "fixed inset-0 z-[60] bg-[var(--f-scrim)] transition-opacity duration-200 ease-out motion-reduce:transition-none",
            isMobile ? "" : "bg-transparent",
            shown ? "opacity-100" : "opacity-0",
          )}
        />
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          forceMount
          aria-label={name}
          aria-describedby={undefined}
          className={cn(
            "z-[61] flex flex-col overflow-hidden bg-elevation-level-1 text-basic-primary shadow-2xl outline-none",
            "transition-transform duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none",
            isMobile
              ? cn(
                  "inset-x-0 bottom-0 max-h-[92dvh] min-h-[40dvh] rounded-t-sheet pb-[env(safe-area-inset-bottom)]",
                  shown ? "translate-y-0" : "translate-y-full",
                )
              : cn(
                  "top-2 right-2 bottom-2 h-auto rounded-sheet",
                  expanded ? "left-2 w-auto" : "w-[min(var(--drawer-width),calc(100vw-16px))]",
                  shown ? "translate-x-0" : "translate-x-[calc(100%+16px)]",
                ),
            className,
          )}
        >
          {isMobile ? (
            <div aria-hidden className="flex shrink-0 justify-center pt-2 pb-1">
              <span className="h-1 w-9 rounded-pill bg-[var(--f-wash-4)]" />
            </div>
          ) : null}
          {bare ? (
            <SheetTitle className="sr-only">{name ?? title}</SheetTitle>
          ) : (
            <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-muted px-4">
              <SheetTitle className="type-strong min-w-0 flex-1 truncate">{title}</SheetTitle>
              {headerActions}
              {!isMobile && onPin ? (
                <Button
                  variant={ButtonVariant.Ghost}
                  size={ButtonSize.Medium}
                  content={ButtonContent.Icon}
                  aria-label="Dock beside the conversation"
                  title="Dock beside the conversation (⌘\)"
                  onClick={onPin}
                >
                  <Icon iconName={IconName.ShowSidePanel} />
                </Button>
              ) : null}
              {!isMobile && onToggleExpanded ? (
                <Button
                  variant={ButtonVariant.Ghost}
                  size={ButtonSize.Medium}
                  content={ButtonContent.Icon}
                  aria-label={expanded ? "Exit full width" : "Full width"}
                  onClick={onToggleExpanded}
                >
                  <Icon iconName={expanded ? IconName.FullScreenExit : IconName.FullScreen} />
                </Button>
              ) : null}
              <Button
                variant={ButtonVariant.Ghost}
                size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
                content={ButtonContent.Icon}
                aria-label="Close"
                onClick={onClose}
              >
                <Icon iconName={IconName.Close} />
              </Button>
            </header>
          )}
          <div
            className={cn("relative flex min-h-0 flex-1 flex-col overflow-y-auto", bodyClassName)}
          >
            {children}
          </div>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}
