import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/app/lib/cn";
import { usePresentationPortalTarget } from "@/app/providers/PresentationBoundary";
import { composeRefs } from "./compose-refs";
import { keepOpen, useLayer, type LayerHandle } from "./layer";

interface PopoverLayer {
  layer: LayerHandle;
  content: React.RefObject<HTMLDivElement | null>;
  anchor: React.RefObject<HTMLElement | null>;
}

const PopoverLayerContext = React.createContext<PopoverLayer | null>(null);

function usePopoverLayer(part: string): PopoverLayer {
  const value = React.useContext(PopoverLayerContext);
  if (!value) throw new Error(`${part} must be rendered inside Popover`);
  return value;
}

type PopoverProps = Omit<React.ComponentProps<typeof PopoverPrimitive.Root>, "modal"> & {
  /** False when the content handles Escape itself. */
  closeOnEscape?: boolean;
  /** False leaves presses outside the panel to the layer below it. */
  closeOnOutsidePress?: boolean;
};

/** A panel layer of its presentation instance; Radix only portals and positions it. */
function Popover({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  closeOnEscape = true,
  closeOnOutsidePress = true,
  children,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);
  const content = React.useRef<HTMLDivElement>(null);
  const anchor = React.useRef<HTMLElement>(null);
  const handle = useLayer({
    open,
    kind: "panel",
    content,
    anchor,
    onEscape: closeOnEscape ? close : undefined,
    onOutsidePress: closeOnOutsidePress ? close : undefined,
  });
  return (
    <PopoverLayerContext.Provider value={{ layer: handle, content, anchor }}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        {children}
      </PopoverPrimitive.Root>
    </PopoverLayerContext.Provider>
  );
}

function PopoverTrigger({ ref, ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const { anchor } = usePopoverLayer("PopoverTrigger");
  const composedRef = React.useMemo(() => composeRefs<HTMLElement>(ref, anchor), [ref, anchor]);
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" ref={composedRef} {...props} />;
}

function PopoverAnchor({ ref, ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  const { anchor } = usePopoverLayer("PopoverAnchor");
  const composedRef = React.useMemo(() => composeRefs<HTMLElement>(ref, anchor), [ref, anchor]);
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" ref={composedRef} {...props} />;
}

type PopoverContentProps = Omit<
  React.ComponentProps<typeof PopoverPrimitive.Content>,
  "onEscapeKeyDown" | "onInteractOutside" | "onPointerDownOutside" | "onFocusOutside"
> & {
  /** False renders the panel in place, keeping its controls in the page's tab order. */
  portal?: boolean;
  container?: HTMLElement | null;
};

function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  collisionPadding = 8,
  portal = true,
  container,
  role,
  onCloseAutoFocus,
  onMouseDownCapture,
  ref,
  ...props
}: PopoverContentProps) {
  const { layer, content } = usePopoverLayer("PopoverContent");
  const target = usePresentationPortalTarget();
  const composedRef = React.useMemo(() => composeRefs(ref, content), [ref, content]);
  const panel = (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn("z-[120] bg-popover text-popover-foreground outline-none", className)}
      {...props}
      // Radix names every popover a dialog; a panel is one only when its owner says so.
      role={role}
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
    />
  );
  if (!portal) return panel;
  return <PopoverPrimitive.Portal container={container ?? target}>{panel}</PopoverPrimitive.Portal>;
}

function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
