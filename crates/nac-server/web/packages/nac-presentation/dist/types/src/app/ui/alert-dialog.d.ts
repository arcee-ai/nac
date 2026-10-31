import type * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ButtonVariant } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from "./dialog";
/**
 * Built on `ui/dialog` rather than Radix's AlertDialog, which forces Radix's
 * document-wide modal mode; the confirmation semantics stay: the `alertdialog`
 * role, a described body, and a scrim that only dismisses when asked to.
 */
declare function AlertDialog(props: Omit<React.ComponentProps<typeof Dialog>, "layer">): React.JSX.Element;
declare function AlertDialogOverlay({ dismissible, ...props }: React.ComponentProps<typeof DialogOverlay>): React.JSX.Element;
declare function AlertDialogContent(props: React.ComponentProps<typeof DialogContent>): React.JSX.Element;
declare function AlertDialogHeader(props: React.ComponentProps<typeof DialogHeader>): React.JSX.Element;
declare function AlertDialogFooter(props: React.ComponentProps<typeof DialogFooter>): React.JSX.Element;
declare function AlertDialogTitle(props: React.ComponentProps<typeof DialogTitle>): React.JSX.Element;
declare function AlertDialogDescription(props: React.ComponentProps<typeof DialogDescription>): React.JSX.Element;
declare function AlertDialogAction({ className, variant, ...props }: React.ComponentProps<typeof DialogPrimitive.Close> & {
    variant?: ButtonVariant;
}): React.JSX.Element;
declare function AlertDialogCancel({ className, variant, ...props }: React.ComponentProps<typeof DialogPrimitive.Close> & {
    variant?: ButtonVariant;
}): React.JSX.Element;
export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, DialogPortal as AlertDialogPortal, AlertDialogTitle, DialogTrigger as AlertDialogTrigger, };
