import {
  usePresentationPortalTarget,
  usePresentationInertTarget,
  usePresentationKeyboardOwner,
} from "@/app/providers/PresentationBoundary";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { createModalId, useModalStack } from "../../hooks/useModalStack";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import StickyButton from "../button/StickyButton";
import CoverBackground from "../cover-background";
import Icon, { IconName } from "../icon";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Kept in step with the mobile slide transition. */
const MOBILE_EXIT_MS = 300;

/** Clearance the scrolling body leaves for the footer floating over it. */
const MOBILE_HEADER_CLEARANCE = "pt-14";
const MOBILE_FOOTER_CLEARANCE = "pb-16";

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
  closeOnOverlay?: boolean;
  /** Full-bleed chrome: header and footer span the card, only the body scrolls. */
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
  closeOnOverlay = true,
  flush = false,
  fullScreen = false,
  chromeless = false,
  mobileCloseIcon = IconName.Left,
  hideClose = false,
  keepOnNavigate = false,
  className = "",
  bodyClassName = "",
  children,
  footer,
}) => {
  const portalTarget = usePresentationPortalTarget();
  const inertTarget = usePresentationInertTarget();

  const ownsKeyboard = usePresentationKeyboardOwner();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const isMobile = useIsMobile();
  const cardRef = useRef<HTMLDivElement>(null);
  // Identity of this dialog in the shared stack. It is state rather than a ref
  // because the render below compares it against the top of the stack.
  const [token] = useState(() => createModalId());
  const previousPathnameRef = useRef("");
  const location = useLocation();
  const { modalStack, pushModal, popModal, isModalOnTop, getStackLength } = useModalStack();

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

  useEffect(() => {
    if (!open) return undefined;
    const self = token;
    pushModal({ id: self });
    // Keep the view background out of the tab order; the overlay target stays
    // reachable. Desktop only: on a phone the panel covers the view and inert
    // is unnecessary.
    const root = inertTarget;
    if (!isMobile) root?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !ownsKeyboard(e.target)) return;
      if (!isModalOnTop(self)) return;
      closeRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      popModal(self);
      // Only clear inert when nothing else is left open.
      if (!isMobile && getStackLength() === 0) {
        root?.removeAttribute("inert");
      }
    };
  }, [
    open,
    ownsKeyboard,
    isMobile,
    token,
    pushModal,
    popModal,
    isModalOnTop,
    getStackLength,
    inertTarget,
  ]);

  // Move focus into the dialog and trap Tab within it. The card itself takes
  // the focus rather than the first field: landing in a text input pops up the
  // keyboard on a phone and steals typing from someone who only meant to read.
  useEffect(() => {
    if (!open) return undefined;
    const card = cardRef.current;
    if (!card) return undefined;
    const focusables = () => Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
    card.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      // The card holds the focus until the first Tab, and it is not one of the
      // items, so shift-tabbing off it would escape into the browser chrome.
      const onCard = document.activeElement === card;
      if (e.shiftKey && (onCard || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    card.addEventListener("keydown", onKey);
    return () => card.removeEventListener("keydown", onKey);
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

  // `flush` used to be the only path with a bordered header. Every dialog uses
  // that chrome now; the flag stays so existing callers remain valid.
  void flush;
  const onTop = modalStack.length === 0 || modalStack[modalStack.length - 1]?.id === token;
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

  const headerRow = (
    <div
      className={cn(
        "flex items-center",
        subheader ? "min-h-14" : "h-full",
        isMobile ? "gap-4 py-1 pl-1 pr-4" : "gap-2 py-1 pl-4 pr-1",
      )}
    >
      {isMobile && onClose ? closeButton(mobileCloseIcon) : null}
      <div className="header-md flex min-w-0 flex-1 items-center text-basic-primary">{title}</div>
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

  const mobileTransform = open
    ? onTop
      ? "translate-x-0"
      : "translate-x-[-30px]"
    : "translate-x-full";

  return createPortal(
    <>
      <CoverBackground
        open={open && (!isMobile || !offscreen)}
        zIndex={100}
        opacity={0.25}
        blur={1}
        className={isMobile ? "!duration-300" : undefined}
        onClick={overlayCloses ? onClose : undefined}
      />
      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-[100] flex",
          // A phone panel is the viewport itself, so it never gets the inset
          // the desktop card sits in.
          !isMobile && "items-center justify-center p-4",
        )}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === "string" ? title : undefined}
          tabIndex={-1}
          data-modal-open={open ? "true" : undefined}
          className={cn(
            "pointer-events-auto relative flex flex-col outline-none",
            isMobile
              ? cn(
                  "rounded-none transition-transform duration-300 ease-in-out",
                  offscreen && open ? "translate-x-full" : mobileTransform,
                  !chromeless && "bg-elevation-ground",
                )
              : cn(
                  "fade w-full",
                  size,
                  chromeless
                    ? "shadow-none"
                    : "max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl bg-elevation-level-2 shadow-xl",
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
              "flex w-full min-h-0 flex-auto flex-col overflow-y-auto",
              floatingHeader && !chromeless && MOBILE_HEADER_CLEARANCE,
              isMobile && footer && MOBILE_FOOTER_CLEARANCE,
            )}
          >
            <div
              className={cn(
                chromeless
                  ? "flex min-h-0 w-full flex-1 flex-col"
                  : "paragraph-medium flex flex-col p-4 text-basic-secondary",
                (isMobile || isFullScreen || flush) && "min-h-0 flex-1",
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
        </div>
      </div>
    </>,
    portalTarget,
  );
};

Modal.Size = ModalSize;

export default Modal;
