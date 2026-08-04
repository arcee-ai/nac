import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import CoverBackground from "../cover-background";
import Icon, { IconName } from "../icon";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Open dialogs, oldest first. Escape is a document-level listener, so without
 * this a dialog opened on top of another would dismiss both at once.
 */
const openModals: object[] = [];

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
  size?: ModalSize;
  closeOnOverlay?: boolean;
  /** Full-bleed chrome: header and footer span the card, only the body scrolls. */
  flush?: boolean;
  /** Grow the card to fill the viewport instead of hugging its content. */
  fullScreen?: boolean;
  /**
   * Drop the card entirely: no header, no padding, no surface of its own. For
   * content that is already a framed box and only needs the scrim and the
   * Escape / overlay handling around it.
   */
  chromeless?: boolean;
  /** Glyph for the close button in the mobile header, where it leads the row. */
  mobileCloseIcon?: IconName;
  className?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Generic dialog: scrim + centered card, or a full-screen sheet on a phone.
 * Closes on overlay click / Escape.
 */
const Modal: React.FC<ModalProps> & { Size: typeof ModalSize } = ({
  open,
  onClose,
  title,
  subheader,
  size = ModalSize.Medium,
  closeOnOverlay = true,
  flush = false,
  fullScreen = false,
  chromeless = false,
  mobileCloseIcon = IconName.Left,
  className = "",
  children,
  footer,
}) => {
  const isMobile = useIsMobile();
  const cardRef = useRef<HTMLDivElement>(null);
  const token = useRef({});

  useEffect(() => {
    if (!open) return undefined;
    const self = token.current;
    openModals.push(self);
    // Keep the app behind out of the tab order; the card is portalled to the
    // body, so it stays reachable.
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openModals[openModals.length - 1] !== self) return;
      onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = openModals.indexOf(self);
      if (index >= 0) openModals.splice(index, 1);
      if (openModals.length === 0) root?.removeAttribute("inert");
    };
  }, [open, onClose]);

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

  if (!open) return null;

  // A phone gets the same full-bleed chrome as `flush`, because a padded card
  // makes no sense once the dialog covers the whole screen.
  const chrome = flush || isMobile;

  const closeButton = (iconName: IconName, leading: boolean) => (
    <Button
      variant={ButtonVariant.Ghost}
      size={ButtonSize.Medium}
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

  // On a phone the close affordance leads the header, the way a back button
  // does — unless the dialog is explicitly full screen.
  const closeLeads = isMobile && !fullScreen;
  // Chromeless fullscreen still needs a way out; regular chrome already puts
  // Close in the header row.
  const chromelessClose = chromeless && fullScreen && onClose;

  const headerRow = (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        chrome && "items-center px-4 py-3",
        isMobile && "min-h-[56px]",
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
      {!closeLeads && onClose ? closeButton(IconName.Close, false) : null}
    </div>
  );

  const header =
    !chromeless && (title || subheader || onClose) ? (
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

  return createPortal(
    <>
      <CoverBackground
        open={open}
        zIndex={100}
        opacity={0.55}
        blur={0}
        onClick={closeOnOverlay ? onClose : undefined}
      />
      <div
        className={cn(
          "fixed inset-0 z-[100] flex pointer-events-none",
          fullScreen ? "p-2" : !isMobile && "items-center justify-center p-4",
        )}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={cn(
            "relative flex flex-col shadow-2xl pointer-events-auto outline-none",
            isMobile
              ? cn(
                  "slide-in-right w-full h-[100dvh] rounded-none",
                  !chromeless && "bg-elevation-level-1",
                )
              : cn(
                  "popup-bounce w-full",
                  size,
                  chromeless
                    ? "shadow-none"
                    : flush
                      ? "rounded-[16px] max-h-[calc(100vh-2rem)] overflow-hidden bg-elevation-level-1 border border-muted"
                      : "gap-4 rounded-[8px] p-5 bg-elevation-level-1 border border-muted",
                  // Fill the padded viewport (8px inset via parent `p-2`).
                  fullScreen &&
                    "max-w-none w-full h-full min-w-0 min-h-0 max-h-none overflow-hidden",
                  fullScreen && !chromeless && "rounded-[8px]",
                ),
            className,
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
                    fullScreen && "flex-1 min-h-0 w-full",
                  ),
            )}
          >
            {children}
          </div>
          {footer ? (
            <div
              className={cn(
                "flex justify-end gap-2",
                chrome && "items-center p-4 border-t border-muted shrink-0",
              )}
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
