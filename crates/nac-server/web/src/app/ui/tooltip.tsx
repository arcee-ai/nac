import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/app/lib/cn";
import { usePresentationPortalTarget } from "@/app/providers/PresentationBoundary";
import { composeRefs } from "./compose-refs";
import { keepOpen, useLayer } from "./layer";

const TooltipContentRef = React.createContext<React.RefObject<HTMLDivElement | null> | null>(null);

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

/**
 * Carries its own provider, so a tooltip works wherever it is rendered, and
 * registers as a hint layer: Escape closes it before anything beneath it.
 */
function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  delayDuration,
  disableHoverableContent,
  children,
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const content = React.useRef<HTMLDivElement>(null);
  useLayer({ open, kind: "hint", content, onEscape: () => setOpen(false) });
  return (
    <TooltipContentRef.Provider value={content}>
      <TooltipProvider
        delayDuration={delayDuration}
        disableHoverableContent={disableHoverableContent}
      >
        <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
          {children}
        </TooltipPrimitive.Root>
      </TooltipProvider>
    </TooltipContentRef.Provider>
  );
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Content>,
  "onEscapeKeyDown"
> & {
  container?: HTMLElement | null;
};

function TooltipContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  container,
  ref,
  ...props
}: TooltipContentProps) {
  const target = usePresentationPortalTarget();
  const content = React.useContext(TooltipContentRef);
  const composedRef = React.useMemo(() => composeRefs(ref, content ?? undefined), [ref, content]);
  return (
    <TooltipPrimitive.Portal container={container ?? target}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("z-[200]", className)}
        {...props}
        ref={composedRef}
        onEscapeKeyDown={keepOpen}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
