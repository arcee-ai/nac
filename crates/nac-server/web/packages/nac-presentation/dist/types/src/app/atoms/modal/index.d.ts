import React from "react";
import { DialogDescription } from "../../ui/dialog";
import { IconName } from "../icon";
export declare enum ModalSize {
    /** Confirmations: one question, two answers. */
    Small = "max-w-[420px]",
    /** The default form dialog. */
    Medium = "max-w-[600px]",
    Wide = "max-w-[640px]",
    Large = "max-w-[760px]"
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
    /**
     * Make the page behind inert on phones too. For a sheet that repeats what
     * the page under it shows (the phone Menu over Home's session list), so the
     * hidden copy is out of reach and out of the accessibility tree.
     */
    inertOnPhone?: boolean;
    className?: string;
    /** Overrides the body's own padding and scrolling, for full-bleed content. */
    bodyClassName?: string;
    children?: React.ReactNode;
    footer?: React.ReactNode;
}
/**
 * Generic dialog. Desktop: a soft scrim and a centred 20px-radius card with
 * a 52px header (quiet title, close), a padded body and a footer of pill
 * actions. Phone: a full-height sheet that pushes in from the right like an
 * iOS navigation step, with its back/close control leading the header and
 * safe-area insets top and bottom. Overlay tap dismisses only on desktop.
 */
declare const Modal: React.FC<ModalProps> & {
    Size: typeof ModalSize;
};
/** Body text the dialog is described by; an `alert` confirmation says in it what goes. */
export declare const ModalDescription: typeof DialogDescription;
export default Modal;
