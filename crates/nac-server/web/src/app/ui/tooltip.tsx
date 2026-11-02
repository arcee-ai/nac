import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/app/lib/cn";
import { usePresentationPortalTarget } from "@/app/providers/PresentationBoundary";
import { composeRefs } from "./compose-refs";
import { keepOpen, useLayer } from "./layer";

interface TooltipParts {
  content: React.RefObject<HTMLDivElement | null>;
  trigger: React.RefObject<HTMLButtonElement | null>;
}

const TooltipPartsContext = React.createContext<TooltipParts | null>(null);

function holdsKeyboardFocus(trigger: HTMLElement | null) {
  const active = document.activeElement;
  return !!active && !!trigger?.contains(active) && active.matches(":focus-visible");
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

/**
 * Carries its own provider, so a tooltip works wherever it is rendered, and
 * registers as a hint layer: Escape closes it before anything beneath it.
 * Radix closes an open tip whenever anything around its trigger scrolls; a tip
 * that keyboard focus holds outlasts that, since moving the focus onto a
 * control can scroll its container by itself.
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
  const trigger = React.useRef<HTMLButtonElement>(null);
  const parts = React.useMemo(() => ({ content, trigger }), []);
  const scrolling = React.useRef(false);
  useLayer({ open, kind: "hint", content, onEscape: () => setOpen(false) });
  // Radix listens for the scroll only once the tip is open, so this listener
  // always runs first and marks the close that the scroll requests.
  React.useLayoutEffect(() => {
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !event.target.contains(trigger.current)) return;
      scrolling.current = true;
      setTimeout(() => {
        scrolling.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
  return (
    <TooltipPartsContext.Provider value={parts}>
      <TooltipProvider
        delayDuration={delayDuration}
        disableHoverableContent={disableHoverableContent}
      >
        <TooltipPrimitive.Root
          open={open}
          onOpenChange={(next) => {
            if (!next && scrolling.current && holdsKeyboardFocus(trigger.current)) return;
            setOpen(next);
          }}
        >
          {children}
        </TooltipPrimitive.Root>
      </TooltipProvider>
    </TooltipPartsContext.Provider>
  );
}

function TooltipTrigger({ ref, ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const parts = React.useContext(TooltipPartsContext);
  const composedRef = React.useMemo(() => composeRefs(ref, parts?.trigger), [ref, parts]);
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} ref={composedRef} />;
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
  const parts = React.useContext(TooltipPartsContext);
  const composedRef = React.useMemo(() => composeRefs(ref, parts?.content), [ref, parts]);
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
