import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
declare function TooltipProvider({ delayDuration, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>): React.JSX.Element;
/**
 * Carries its own provider, so a tooltip works wherever it is rendered, and
 * registers as a hint layer: Escape closes it before anything beneath it.
 */
declare function Tooltip({ open: openProp, defaultOpen, onOpenChange, delayDuration, disableHoverableContent, children, }: React.ComponentProps<typeof TooltipPrimitive.Root>): React.JSX.Element;
declare function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>): React.JSX.Element;
type TooltipContentProps = Omit<React.ComponentProps<typeof TooltipPrimitive.Content>, "onEscapeKeyDown"> & {
    container?: HTMLElement | null;
};
declare function TooltipContent({ className, sideOffset, collisionPadding, container, ref, ...props }: TooltipContentProps): React.JSX.Element;
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
