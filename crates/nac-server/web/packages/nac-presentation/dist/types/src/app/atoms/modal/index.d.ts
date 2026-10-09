import React from "react";
import { IconName } from "../icon";
export declare enum ModalSize {
    Small = "max-w-[400px]",
    Medium = "max-w-[560px]",
    Wide = "max-w-[600px]",
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
declare const Modal: React.FC<ModalProps> & {
    Size: typeof ModalSize;
};
export default Modal;
