import type * as React from "react";

import { cn } from "@/app/lib/cn";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

type SheetSide = "top" | "right" | "bottom" | "left";

const sideClasses = {
  top: "inset-x-0 top-0",
  right: "inset-y-0 right-0 h-full",
  bottom: "inset-x-0 bottom-0",
  left: "inset-y-0 left-0 h-full",
} satisfies Record<SheetSide, string>;

function Sheet({ layer = "sheet", ...props }: React.ComponentProps<typeof Dialog>) {
  return <Dialog layer={layer} {...props} />;
}

function SheetContent({
  side = "right",
  className,
  ...props
}: React.ComponentProps<typeof DialogContent> & { side?: SheetSide }) {
  return (
    <DialogContent
      data-slot="sheet-content"
      data-side={side}
      className={cn("fixed flex flex-col outline-none", sideClasses[side], className)}
      {...props}
    />
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-footer" className={cn("mt-auto flex gap-2", className)} {...props} />
  );
}

export {
  Sheet,
  DialogClose as SheetClose,
  SheetContent,
  DialogDescription as SheetDescription,
  SheetFooter,
  SheetHeader,
  DialogOverlay as SheetOverlay,
  DialogPortal as SheetPortal,
  DialogTitle as SheetTitle,
  DialogTrigger as SheetTrigger,
};
