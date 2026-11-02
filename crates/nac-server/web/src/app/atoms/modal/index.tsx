import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/cn";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../../ui/dialog";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import StickyButton from "../button/StickyButton";
import CoverBackground from "../cover-background";
import Icon, { IconName } from "../icon";

/** Kept in step with the mobile slide transition. */
const MOBILE_EXIT_MS = 300;

/** Clearance the body leaves for the phone header floating over it. */
const MOBILE_HEADER_CLEARANCE = "pt-14";
/**
 * Clearance the body leaves for the phone footer floating over it (64px plus
 * the body's own 16px). A full-bleed `bodyClassName` such as `p-0` drops it.
 */
const MOBILE_FOOTER_CLEARANCE = "pb-20";

export enum ModalSize {
  Small = "max-w-[400px]",
  /** Figma ModalBox default width. */
  Medium = "max-w-[604px]",
  Wide = "max-w-[600px]",
  Large = "max-w-[760px]",
}

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /**
   * Optional route-change dismissal kept separate from manual dismissal. A
   * submitting dialog can hide its close affordances without surviving over
   * the destination route.
   */
  onNavigate?: () => void;
  title?: React.ReactNode;
  /** Secondary row under the title, inside the same header block. */
  subheader?: React.ReactNode;
  /** Controls of the dialog's own, trailing the title in the header row. */
  headerActions?: React.ReactNode;
  size?: ModalSize;
  /** Surface and scrim layer for a dialog opened above a panel or sheet. */
  zIndex?: number;
  closeOnOverlay?: boolean;
  /** Stretch the body over a card the caller sizes; it still grows with its content. */
  flush?: boolean;
  /**
   * Grow the card to fill the viewport instead of hugging its content. Desktop
   * only — a phone panel already is the viewport, and keeps the chrome every
   * other dialog has there.
   */
  fullScreen?: boolean;
  /**
   * Drop the card entirely: no header, no padding, no surface of its own. For
   * content that is already a framed box and only needs the scrim and the
   * Escape / overlay handling around it.
   */
  chromeless?: boolean;
  /** Glyph for the close button in the mobile header, where it leads the row. */
  mobileCloseIcon?: IconName;
  /**
   * Drop the close button a chromeless dialog floats over its content, for
   * bodies that already carry a way out in a header of their own.
   */
  hideClose?: boolean;
  /**
   * Stay open across a route change, for a dialog whose own content is what
   * puts the route there — the session side box switches panels by navigating.
   */
  keepOnNavigate?: boolean;
  /**
   * A confirmation before something that cannot be undone: the card is an
   * `alertdialog`, described by the `ModalDescription` in its body.
   */
  alert?: boolean;
  className?: string;
  /** Overrides the body's own padding and scrolling, for full-bleed content. */
  bodyClassName?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Generic dialog: scrim + centered card on desktop, or a full-screen panel
 * that slides in from the right on a phone (same pattern as ArceeFM's
 * ModalBoxMobile). Overlay tap dismisses only on desktop.
 */
const Modal: React.FC<ModalProps> & { Size: typeof ModalSize } = ({
  open,
  onClose,
  onNavigate,
  title,
  subheader,
  headerActions,
  size = ModalSize.Medium,
  zIndex = 100,
  closeOnOverlay = true,
  flush = false,
  fullScreen = false,
  chromeless = false,
  mobileCloseIcon = IconName.Left,
  hideClose = false,
  keepOnNavigate = false,
  alert = false,
  className = "",
  bodyClassName = "",
  children,
  footer,
}) => {
  const isMobile = useIsMobile();
  const cardRef = useRef<HTMLDivElement>(null);
  const previousPathnameRef = useRef("");
  const location = useLocation();

  // Mobile keeps the panel mounted through the exit slide; desktop unmounts
  // immediately because the enter animation is a one-shot fade.
  const [mounted, setMounted] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  const [offscreen, setOffscreen] = useState(true);

  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setMounted(true);
      if (isMobile) setOffscreen(true);
    } else if (isMobile) {
      // Send the panel back off-screen; the timer below unmounts it once the
      // slide has run.
      setOffscreen(true);
    } else {
      setMounted(false);
    }
  }

  useEffect(() => {
    if (!open || !isMobile || !mounted) return undefined;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setOffscreen(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, isMobile, mounted]);

  useEffect(() => {
    if (open || !isMobile || !mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), MOBILE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, isMobile, mounted]);

  // The card itself takes the focus rather than the first field: landing in a
  // text input pops up the keyboard on a phone and steals typing from someone
  // who only meant to read.
  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  // Close when navigating away — leftover dialogs over a new route are wrong.
  useEffect(() => {
    if (
      previousPathnameRef.current &&
      previousPathnameRef.current !== location.pathname &&
      open &&
      !keepOnNavigate
    ) {
      (onNavigate ?? onClose)?.();
    }
    previousPathnameRef.current = location.pathname;
  }, [location.pathname, open, onClose, onNavigate, keepOnNavigate]);

  if (!mounted) return null;

  const Root = alert ? AlertDialog : Dialog;
  const Overlay = alert ? AlertDialogOverlay : DialogOverlay;
  const Content = alert ? AlertDialogContent : DialogContent;
  const Title = alert ? AlertDialogTitle : DialogTitle;

  // On a phone the scrim never dismisses — only the back/close control does.
  const overlayCloses = closeOnOverlay && !isMobile;

  const closeButton = (iconName: IconName) =>
    isMobile ? (
      <StickyButton
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        className="shrink-0"
        aria-label="Close"
        onClick={onClose}
      >
        <Icon iconName={iconName} />
      </StickyButton>
    ) : (
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Icon}
        className={cn("shrink-0", iconName === IconName.Close && "btn-icon-rotate")}
        aria-label="Close"
        onClick={onClose}
      >
        <Icon iconName={iconName} />
      </Button>
    );

  // A phone panel is the viewport already, so `fullScreen` has nothing left to
  // ask for there — and it must not reshape the chrome either, or the dialog
  // would look unlike every other one on the phone.
  const isFullScreen = fullScreen && !isMobile;
  // On a phone the close affordance leads the header, the way a back button
  // does. A subheader stays in flow so the body starts below it; a title-only
  // header floats and the body scrolls underneath the fade.
  const floatingHeader = isMobile && !subheader;
  // Chromeless still needs a way out once it covers the screen; regular chrome
  // already puts Close in the header row.
  const chromelessClose = chromeless && (isFullScreen || isMobile) && onClose && !hideClose;

  const titleClassName = "header-md flex min-w-0 flex-1 items-center text-basic-primary";
  const headerRow = (
    <div
      className={cn(
        "flex items-center",
        subheader ? "min-h-14" : "h-full",
        isMobile ? cn("gap-4 py-1 pl-2", headerActions ? "pr-1" : "pr-4") : "gap-2 py-1 pl-4 pr-2",
      )}
    >
      {isMobile && onClose ? closeButton(mobileCloseIcon) : null}
      {title ? (
        <Title asChild>
          <div className={titleClassName}>{title}</div>
        </Title>
      ) : (
        <div className={titleClassName} />
      )}
      {headerActions ? (
        <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
      ) : null}
      {!isMobile && onClose ? closeButton(IconName.Close) : null}
    </div>
  );

  const header =
    !chromeless && (title || subheader || headerActions || onClose) ? (
      <header
        className={cn(
          "flex flex-col",
          isMobile
            ? cn(
                "fade-from-top z-10",
                subheader ? "shrink-0" : "h-14",
                floatingHeader ? "absolute inset-x-0 top-0" : "shrink-0",
              )
            : cn("shrink-0 border-b border-muted", subheader ? "min-h-14" : "h-14"),
        )}
      >
        {headerRow}
        {subheader ? <div className="px-4 pb-3">{subheader}</div> : null}
      </header>
    ) : null;

  const mobileTransform =
    open && !offscreen ? "translate-x-0 data-[covered]:translate-x-[-30px]" : "translate-x-full";

  return (
    <Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
      // Desktop only: on a phone the panel covers the view and inert is unnecessary.
      inertBackground={!isMobile}
    >
      <DialogPortal forceMount>
        <Overlay asChild dismissible={overlayCloses}>
          <CoverBackground
            open={open && (!isMobile || !offscreen)}
            zIndex={zIndex}
            opacity={0.25}
            blur={1}
            className={isMobile ? "!duration-300" : undefined}
          />
        </Overlay>
        <div
          style={{ zIndex }}
          className={cn(
            "pointer-events-none fixed inset-0 z-[100] flex",
            // A phone panel is the viewport itself, so it never gets the inset
            // the desktop card sits in.
            !isMobile && "items-center justify-center p-4",
          )}
        >
          <Content
            ref={cardRef}
            forceMount
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            tabIndex={-1}
            data-modal-open={open ? "true" : undefined}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className={cn(
              "pointer-events-auto relative flex flex-col outline-none",
              isMobile
                ? cn(
                    "rounded-none transition-transform duration-300 ease-in-out motion-reduce:transition-none",
                    mobileTransform,
                    !chromeless && "bg-elevation-ground",
                  )
                : cn(
                    "fade w-full motion-reduce:!animate-none",
                    size,
                    chromeless
                      ? "shadow-none"
                      : "max-h-[calc(100vh-2rem)] overflow-hidden rounded-[20px] bg-elevation-level-2 shadow-xl",
                    isFullScreen && "h-full max-h-none min-h-0 w-full max-w-none overflow-hidden",
                  ),
              className,
              // Callers size the desktop card through `className`
              // (CreateProjectModal asks for `h-[680px]`). On a phone the panel
              // *is* the screen, so
              // its own sizing has to win: it comes after `className`, which is
              // where tailwind-merge resolves the conflict, and the min/max pair
              // clamps anything the caller adds on top.
              isMobile && "h-[100dvh] max-h-[100dvh] min-h-[100dvh] w-full min-w-full max-w-full",
            )}
          >
            {chromelessClose ? (
              <div className="absolute top-1 right-2 z-10">{closeButton(IconName.Close)}</div>
            ) : null}
            {header}
            <div
              className={cn(
                "flex w-full min-h-0 flex-auto flex-col overflow-auto overscroll-contain",
                floatingHeader && !chromeless && MOBILE_HEADER_CLEARANCE,
              )}
            >
              <div
                className={cn(
                  chromeless
                    ? "flex min-h-0 w-full flex-1 flex-col"
                    : "paragraph-medium flex flex-col p-4 text-basic-secondary",
                  // A phone or full-screen body is pinned to the visible height so
                  // `h-full` children can scroll themselves; it scrolls too, so
                  // taller content keeps the padding and footer clearance below it.
                  // A flush card body fills the card but grows with its content,
                  // so the wrapper scrolls it; panes that scroll themselves pass
                  // `min-h-0` or `overflow-hidden` to stay pinned.
                  isMobile || isFullScreen ? "min-h-0 flex-1 overflow-auto" : flush && "flex-1",
                  isMobile && footer && MOBILE_FOOTER_CLEARANCE,
                  bodyClassName,
                )}
              >
                {children}
              </div>
            </div>
            {footer ? (
              <footer
                className={cn(
                  "modal-footer flex items-center justify-end",
                  isMobile
                    ? "modal-footer-mobile fade-from-bottom absolute inset-x-0 bottom-0 z-10 gap-3 p-3"
                    : "shrink-0 gap-2 border-t border-muted p-4",
                )}
              >
                {footer}
              </footer>
            ) : null}
          </Content>
        </div>
      </DialogPortal>
    </Root>
  );
};

Modal.Size = ModalSize;

/** Body text the dialog is described by; an `alert` confirmation says in it what goes. */
export const ModalDescription = DialogDescription;

export default Modal;
