import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "@/app/lib/cn";
import { usePresentationPortalTarget } from "@/app/providers/PresentationBoundary";
import { composeRefs } from "./compose-refs";
import { keepOpen, useLayer, type LayerHandle } from "./layer";

interface MenuLayer {
  layer: LayerHandle;
  content: React.RefObject<HTMLDivElement | null>;
  anchor: React.RefObject<HTMLElement | null>;
}

const MenuLayerContext = React.createContext<MenuLayer | null>(null);

function useMenuLayer(part: string): MenuLayer {
  const value = React.useContext(MenuLayerContext);
  if (!value) throw new Error(`${part} must be rendered inside DropdownMenu`);
  return value;
}

/** A panel layer of its presentation instance, like `ui/popover`. */
function DropdownMenu({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  dir,
  children,
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Root>, "modal">) {
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
    onEscape: close,
    onOutsidePress: close,
  });
  return (
    <MenuLayerContext.Provider value={{ layer: handle, content, anchor }}>
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen} modal={false} dir={dir}>
        {children}
      </DropdownMenuPrimitive.Root>
    </MenuLayerContext.Provider>
  );
}

function DropdownMenuTrigger({
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  const { anchor } = useMenuLayer("DropdownMenuTrigger");
  const composedRef = React.useMemo(() => composeRefs<HTMLElement>(ref, anchor), [ref, anchor]);
  return (
    <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" ref={composedRef} {...props} />
  );
}

type DropdownMenuContentProps = Omit<
  React.ComponentProps<typeof DropdownMenuPrimitive.Content>,
  "onEscapeKeyDown" | "onInteractOutside" | "onPointerDownOutside" | "onFocusOutside"
> & {
  container?: HTMLElement | null;
};

function DropdownMenuContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  container,
  onCloseAutoFocus,
  onMouseDownCapture,
  ref,
  ...props
}: DropdownMenuContentProps) {
  const { layer, content } = useMenuLayer("DropdownMenuContent");
  const target = usePresentationPortalTarget();
  const composedRef = React.useMemo(() => composeRefs(ref, content), [ref, content]);
  return (
    <DropdownMenuPrimitive.Portal container={container ?? target}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "fade z-[120] flex min-w-[160px] max-h-(--radix-dropdown-menu-content-available-height) flex-col gap-1 overflow-y-auto rounded-[8px] bg-popover p-2 text-popover-foreground shadow-2xl outline-none motion-reduce:!animate-none [&>*]:shrink-0",
          className,
        )}
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
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "label-small flex h-8 cursor-default items-center gap-2 rounded-[6px] px-2 outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("label-micro px-2 py-1 text-muted-foreground", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-2 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("ml-auto text-micro text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
};
