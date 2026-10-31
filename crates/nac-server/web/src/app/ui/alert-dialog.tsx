import type * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { ButtonVariant, buttonVariants } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

/**
 * Built on `ui/dialog` rather than Radix's AlertDialog, which forces Radix's
 * document-wide modal mode; the confirmation semantics stay: the `alertdialog`
 * role, a described body, and a scrim that only dismisses when asked to.
 */
function AlertDialog(props: Omit<React.ComponentProps<typeof Dialog>, "layer">) {
  return <Dialog {...props} layer="modal" />;
}

function AlertDialogOverlay({
  dismissible = false,
  ...props
}: React.ComponentProps<typeof DialogOverlay>) {
  return <DialogOverlay data-slot="alert-dialog-overlay" dismissible={dismissible} {...props} />;
}

function AlertDialogContent(props: React.ComponentProps<typeof DialogContent>) {
  return <DialogContent data-slot="alert-dialog-content" role="alertdialog" {...props} />;
}

function AlertDialogHeader(props: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader data-slot="alert-dialog-header" {...props} />;
}

function AlertDialogFooter(props: React.ComponentProps<typeof DialogFooter>) {
  return <DialogFooter data-slot="alert-dialog-footer" {...props} />;
}

function AlertDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle data-slot="alert-dialog-title" {...props} />;
}

function AlertDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  return <DialogDescription data-slot="alert-dialog-description" {...props} />;
}

function AlertDialogAction({
  className,
  variant = ButtonVariant.Primary,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close> & { variant?: ButtonVariant }) {
  return (
    <DialogPrimitive.Close
      data-slot="alert-dialog-action"
      className={buttonVariants({ variant, className })}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  variant = ButtonVariant.Tertiary,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close> & { variant?: ButtonVariant }) {
  return (
    <DialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={buttonVariants({ variant, className })}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  DialogPortal as AlertDialogPortal,
  AlertDialogTitle,
  DialogTrigger as AlertDialogTrigger,
};
