import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
type PopoverProps = Omit<React.ComponentProps<typeof PopoverPrimitive.Root>, "modal"> & {
    /** False when the content handles Escape itself. */
    closeOnEscape?: boolean;
    /** False leaves presses outside the panel to the layer below it. */
    closeOnOutsidePress?: boolean;
};
/** A panel layer of its presentation instance; Radix only portals and positions it. */
declare function Popover({ open: openProp, defaultOpen, onOpenChange, closeOnEscape, closeOnOutsidePress, children, }: PopoverProps): React.JSX.Element;
declare function PopoverTrigger({ ref, ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>): React.JSX.Element;
declare function PopoverAnchor({ ref, ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>): React.JSX.Element;
type PopoverContentProps = Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "onEscapeKeyDown" | "onInteractOutside" | "onPointerDownOutside" | "onFocusOutside"> & {
    /** False renders the panel in place, keeping its controls in the page's tab order. */
    portal?: boolean;
    container?: HTMLElement | null;
};
declare function PopoverContent({ className, align, sideOffset, collisionPadding, portal, container, role, onCloseAutoFocus, onMouseDownCapture, ref, ...props }: PopoverContentProps): React.JSX.Element;
declare function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>): React.JSX.Element;
export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
