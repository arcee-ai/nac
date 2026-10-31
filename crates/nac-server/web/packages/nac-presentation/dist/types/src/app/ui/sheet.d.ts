import type * as React from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from "./dialog";
type SheetSide = "top" | "right" | "bottom" | "left";
declare function Sheet({ layer, ...props }: React.ComponentProps<typeof Dialog>): React.JSX.Element;
declare function SheetContent({ side, className, ...props }: React.ComponentProps<typeof DialogContent> & {
    side?: SheetSide;
}): React.JSX.Element;
declare function SheetHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function SheetFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
export { Sheet, DialogClose as SheetClose, SheetContent, DialogDescription as SheetDescription, SheetFooter, SheetHeader, DialogOverlay as SheetOverlay, DialogPortal as SheetPortal, DialogTitle as SheetTitle, DialogTrigger as SheetTrigger, };
