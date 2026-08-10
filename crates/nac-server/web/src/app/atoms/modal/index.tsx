import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useModalStack } from "../../hooks/useModalStack";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import CoverBackground from "../cover-background";
import Icon, { IconName } from "../icon";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Kept in step with the mobile slide transition. */
const MOBILE_EXIT_MS = 300;

// TopBar's "HeaderSurface" turned upside down: the phone footer floats over the
// scrolling body, so it fades the content passing underneath the same way the
// bar fades what scrolls below it. Stacked twice for the same opacity.
const GROUND_FADE_UP =
  "linear-gradient(to top, var(--color-bg-elevation-level-1), var(--color-bg-elevation-ground-transparent))";
const MOBILE_FOOTER_SURFACE = {
  backgroundImage: `${GROUND_FADE_UP}, ${GROUND_FADE_UP}`,
};

/** Clearance the scrolling body leaves for the footer floating over it. */
const MOBILE_FOOTER_CLEARANCE = "pb-[88px]";

export enum ModalSize {
  Small = "max-w-[400px]",
  Medium = "max-w-[560px]",
  Wide = "max-w-[600px]",
  Large = "max-w-[760px]",
}

interface ModalProps {
  open: boolean;
  onClose?: () => void;
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
  const isMobile = useIsMobile();
  const cardRef = useRef<HTMLDivElement>(null);
  // Identity of this dialog in the shared stack. It is state rather than a ref
  // because the render below compares it against the top of the stack.
  const [token] = useState(() => ({}));
  const previousPathnameRef = useRef("");
  const location = useLocation();
  const { modalStack, pushModal, popModal, isModalOnTop, getStackLength } =
    useModalStack();

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
    // Keep the app behind out of the tab order; the card is portalled to the
    // body, so it stays reachable. Desktop only: on a phone the panel covers
    // the viewport and inert is unnecessary (matches ArceeFM).
    const root = document.getElementById("root");
    if (!isMobile) root?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!isModalOnTop(self)) return;
      onClose?.();
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
    onClose,
    isMobile,
    token,
    pushModal,
    popModal,
    isModalOnTop,
    getStackLength,
  ]);

  // Move focus into the dialog and trap Tab within it. The card itself takes
  // the focus rather than the first field: landing in a text input pops up the
  // keyboard on a phone and steals typing from someone who only meant to read.
  useEffect(() => {
    if (!open) return undefined;
    const card = cardRef.current;
    if (!card) return undefined;
    const focusables = () =>
      Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      onClose?.();
    }
    previousPathnameRef.current = location.pathname;
  }, [location.pathname, open, onClose, keepOnNavigate]);

  if (!mounted) return null;

  // A phone gets the same full-bleed chrome as `flush`, because a padded card
  // makes no sense once the dialog covers the whole screen.
  const chrome = flush || isMobile;
  const onTop =
    modalStack.length === 0 || modalStack[modalStack.length - 1]?.id === token;
  // On a phone the scrim never dismisses — only the back/close control does.
  const overlayCloses = closeOnOverlay && !isMobile;

  const closeButton = (iconName: IconName, leading: boolean) => (
    <Button
      variant={ButtonVariant.Ghost}
      size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
      content={ButtonContent.Icon}
      className={cn(
        "shrink-0",
        iconName === IconName.Close && "btn-icon-rotate",
        !chrome && !leading && "-mr-1",
      )}
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
  // does.
  const closeLeads = isMobile;
  // Chromeless still needs a way out once it covers the screen; regular chrome
  // already puts Close in the header row.
  const chromelessClose =
    chromeless && (isFullScreen || isMobile) && onClose && !hideClose;

  const headerRow = (
    <div
      className={cn(
        "flex items-start justify-between gap-2 md:gap-4",
        chrome && "items-center px-4 py-3",
        isMobile && "min-h-[64px] h-[64px] max-h-[64px] px-3",
      )}
    >
      {closeLeads && onClose ? closeButton(mobileCloseIcon, true) : null}
      <div
        className={cn(
          "flex-1 min-w-0 text-basic-primary",
          chrome ? "header-md" : "header-medium",
        )}
      >
        {title}
      </div>
      {headerActions ? (
        <div className="flex items-center gap-1 shrink-0">{headerActions}</div>
      ) : null}
      {!closeLeads && onClose ? closeButton(IconName.Close, false) : null}
    </div>
  );

  const header =
    !chromeless && (title || subheader || headerActions || onClose) ? (
      chrome ? (
        <div className="shrink-0 border-b border-muted">
          {headerRow}
          {subheader ? <div className="px-4 pb-3">{subheader}</div> : null}
        </div>
      ) : (
        <>
          {headerRow}
          {subheader ? <div className="shrink-0">{subheader}</div> : null}
        </>
      )
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
        opacity={0.55}
        blur={0}
        className={isMobile ? "!duration-300" : undefined}
        onClick={overlayCloses ? onClose : undefined}
      />
      <div
        className={cn(
          "fixed inset-0 z-[100] flex pointer-events-none",
          // A phone panel is the viewport itself, so it never gets the inset
          // the desktop card sits in.
          !isMobile &&
            (isFullScreen ? "p-2" : "items-center justify-center p-4"),
        )}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          data-modal-open={open ? "true" : undefined}
          className={cn(
            "relative flex flex-col shadow-2xl pointer-events-auto outline-none",
            isMobile
              ? cn(
                  "rounded-none transition-transform duration-300 ease-in-out",
                  offscreen && open ? "translate-x-full" : mobileTransform,
                  !chromeless && "bg-elevation-level-1",
                )
              : cn(
                  "fade w-full",
                  size,
                  chromeless
                    ? "shadow-none"
                    : flush
                      ? "rounded-[16px] max-h-[calc(100vh-2rem)] overflow-hidden bg-elevation-level-1 border border-muted"
                      : "gap-4 rounded-[8px] p-5 bg-elevation-level-1 border border-muted",
                  // Fill the padded viewport (8px inset via parent `p-2`).
                  isFullScreen &&
                    "max-w-none w-full h-full min-w-0 min-h-0 max-h-none overflow-hidden",
                  isFullScreen && !chromeless && "rounded-[8px]",
                ),
            className,
            // Callers size the desktop card through `className` (LaunchModal
            // asks for `h-[680px]`). On a phone the panel *is* the screen, so
            // its own sizing has to win: it comes after `className`, which is
            // where tailwind-merge resolves the conflict, and the min/max pair
            // clamps anything the caller adds on top.
            isMobile &&
              "w-full h-[100dvh] min-w-full min-h-[100dvh] max-w-full max-h-[100dvh]",
          )}
        >
          {chromelessClose ? (
            <div className="absolute top-1 right-2 z-10">
              {closeButton(IconName.Close, false)}
            </div>
          ) : null}
          {header}
          <div
            className={cn(
              chromeless
                ? "flex flex-col flex-1 min-h-0 w-full"
                : cn(
                    "paragraph-medium text-basic-secondary",
                    chrome && "flex-1 min-h-0 overflow-auto px-4 py-6",
                    isFullScreen && "flex-1 min-h-0 w-full",
                    isMobile && footer && MOBILE_FOOTER_CLEARANCE,
                  ),
              bodyClassName,
            )}
          >
            {children}
          </div>
          {footer ? (
            <div
              className={cn(
                "flex justify-end gap-2",
                chrome && "items-center p-4 shrink-0",
                chrome && !isMobile && "border-t border-muted",
                // Floats over the body rather than taking a row of its own, so
                // the fade below shows the content it is covering.
                isMobile && "absolute inset-x-0 bottom-0 z-10",
              )}
              style={isMobile ? MOBILE_FOOTER_SURFACE : undefined}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
};

Modal.Size = ModalSize;

export default Modal;
