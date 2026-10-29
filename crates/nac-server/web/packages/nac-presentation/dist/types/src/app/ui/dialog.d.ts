import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
type DialogProps = Omit<React.ComponentProps<typeof DialogPrimitive.Root>, "modal"> & {
    /** `sheet` covers the view with a scrim but leaves shortcuts on. */
    layer?: "modal" | "sheet";
    /** Takes the presentation content out of the tab order while the dialog is open. */
    inertBackground?: boolean;
};
/**
 * Radix runs non-modal here: its modal mode hides and locks the whole document,
 * which reaches past the presentation instance into the host page and into a
 * second instance beside it. The instance's layer stack provides the modality
 * instead — Escape, the scrim, background inertness and focus return.
 */
declare function Dialog({ open: openProp, defaultOpen, onOpenChange, layer, inertBackground, children, }: DialogProps): React.JSX.Element;
declare function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>): React.JSX.Element;
declare function DialogPortal({ container, ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>): React.JSX.Element;
declare function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>): React.JSX.Element;
type DialogOverlayProps = React.ComponentProps<"div"> & {
    asChild?: boolean;
    /** A click on the scrim closes the dialog. */
    dismissible?: boolean;
};
/**
 * The scrim. It keeps the page behind it from scrolling and, when dismissible,
 * closes the dialog on a click that also started on it while the dialog was the
 * topmost layer — a press that only dismissed a menu above it does not count.
 */
declare function DialogOverlay({ asChild, dismissible, className, onMouseDown, onClick, ref, ...props }: DialogOverlayProps): React.JSX.Element;
type DialogContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "onEscapeKeyDown" | "onInteractOutside" | "onPointerDownOutside" | "onFocusOutside">;
/**
 * The dialog surface alone; compose `DialogPortal` and `DialogOverlay` around
 * it. Radix wraps Tab between the first and last control, but not Shift+Tab
 * from the surface itself, which holds the focus when nothing inside took it.
 */
declare function DialogContent({ onCloseAutoFocus, onKeyDown, onMouseDownCapture, ref, ...props }: DialogContentProps): React.JSX.Element;
declare function DialogHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DialogFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>): React.JSX.Element;
declare function DialogDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>): React.JSX.Element;
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger, };
