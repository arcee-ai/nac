import * as React from "react";
import { Dialog as DialogPrimitive, Slot } from "radix-ui";

import { cn } from "@/app/lib/cn";
import { usePresentationPortalTarget } from "@/app/providers/PresentationBoundary";
import { composeRefs } from "./compose-refs";
import { keepOpen, useLayer, type LayerHandle } from "./layer";
import { FOCUSABLE } from "./layer-stack";

interface DialogLayer {
  layer: LayerHandle;
  content: React.RefObject<HTMLDivElement | null>;
  close: () => void;
}

const DialogLayerContext = React.createContext<DialogLayer | null>(null);

function useDialogLayer(part: string): DialogLayer {
  const value = React.useContext(DialogLayerContext);
  if (!value) throw new Error(`${part} must be rendered inside Dialog`);
  return value;
}

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
function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  layer = "modal",
  inertBackground = layer === "modal",
  children,
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);
  const content = React.useRef<HTMLDivElement>(null);
  const handle = useLayer({ open, kind: layer, content, inertBackground, onEscape: close });
  return (
    <DialogLayerContext.Provider value={{ layer: handle, content, close }}>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        {children}
      </DialogPrimitive.Root>
    </DialogLayerContext.Provider>
  );
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const target = usePresentationPortalTarget();
  return <DialogPrimitive.Portal container={container ?? target} {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function lockScroll(node: HTMLElement | null) {
  if (!node) return undefined;
  const stop = (event: Event) => event.preventDefault();
  node.addEventListener("wheel", stop, { passive: false });
  node.addEventListener("touchmove", stop, { passive: false });
  return () => {
    node.removeEventListener("wheel", stop);
    node.removeEventListener("touchmove", stop);
  };
}

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
function DialogOverlay({
  asChild = false,
  dismissible = true,
  className,
  onMouseDown,
  onClick,
  ref,
  ...props
}: DialogOverlayProps) {
  const { layer, close } = useDialogLayer("DialogOverlay");
  const pressed = React.useRef(false);
  const composedRef = React.useMemo(() => composeRefs(ref, lockScroll), [ref]);
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="dialog-overlay"
      className={cn(!asChild && "fixed inset-0", className)}
      {...props}
      ref={composedRef}
      onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
        onMouseDown?.(event);
        pressed.current = event.button === 0 && layer.isTop();
      }}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        onClick?.(event);
        const wasPressed = pressed.current;
        pressed.current = false;
        if (dismissible && wasPressed && !event.defaultPrevented) close();
      }}
    />
  );
}

type DialogContentProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Content>,
  "onEscapeKeyDown" | "onInteractOutside" | "onPointerDownOutside" | "onFocusOutside"
>;

/** Controls in native Tab order, excluding hidden, disabled and inert descendants. */
function tabStops(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((node) => {
      if (node.tabIndex < 0 || node.matches(":disabled, input[type=hidden]")) return false;
      if (node.closest("[hidden], [inert]")) return false;
      if (getComputedStyle(node).visibility === "hidden") return false;
      for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
        if (getComputedStyle(ancestor).display === "none") return false;
        if (ancestor === surface) break;
      }
      return true;
    })
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

/**
 * The dialog surface alone; compose `DialogPortal` and `DialogOverlay` around
 * it. Tab boundaries belong to this instance's top layer: Radix's global
 * FocusScope stack can be paused by a dialog in an unrelated embedded view.
 */
function DialogContent({
  onCloseAutoFocus,
  onKeyDown,
  onMouseDownCapture,
  ref,
  ...props
}: DialogContentProps) {
  const { layer, content } = useDialogLayer("DialogContent");
  const composedRef = React.useMemo(() => composeRefs(ref, content), [ref, content]);
  return (
    <DialogPrimitive.Content
      data-slot="dialog-content"
      data-covered={layer.covered ? "" : undefined}
      {...props}
      ref={composedRef}
      onEscapeKeyDown={keepOpen}
      onInteractOutside={keepOpen}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        event.preventDefault();
      }}
      onMouseDownCapture={(event) => {
        onMouseDownCapture?.(event);
        layer.markPressInside();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const surface = event.currentTarget;
        if (event.defaultPrevented || event.key !== "Tab" || !layer.isTop()) return;
        // React portal events bubble through their parent dialog, but the
        // portalled panel owns its own controls and must keep their Tab order.
        const active = surface.ownerDocument.activeElement;
        if (!surface.contains(active)) return;
        const stops = tabStops(surface);
        const first = stops[0];
        const last = stops.at(-1);
        const destination = event.shiftKey ? last : first;
        if (
          !destination ||
          active === surface ||
          (event.shiftKey ? active === first : active === last)
        ) {
          event.preventDefault();
          (destination ?? surface).focus();
        }
      }}
    />
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

function DialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />;
}

function DialogDescription(props: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
