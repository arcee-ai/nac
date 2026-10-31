import type * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/app/lib/cn";

export enum ButtonSize {
  Medium = "btn-medium",
  Small = "btn-small",
  Large = "btn-large",
}

export enum ButtonVariant {
  Primary = "btn-primary",
  Secondary = "btn-secondary",
  SecondaryHighlighted = "btn-secondary-highlighted",
  SecondaryDestructive = "btn-secondary-destructive",
  SecondaryAccent = "btn-secondary-accent",
  SecondaryAccentHighlighted = "btn-secondary-accent-highlighted",
  Tertiary = "btn-tertiary",
  TertiaryDestructive = "btn-tertiary-destructive",
  TertiaryAccent = "btn-tertiary-accent",
  Ghost = "btn-ghost",
  GhostDestructive = "btn-ghost-destructive",
  GhostAccent = "btn-ghost-accent",
  GhostHighlighted = "btn-ghost-highlighted",
  GhostHighlightedAccent = "btn-ghost-highlighted-accent",
}

export enum ButtonContent {
  Icon = "btn-icon",
  IconLeft = "btn-icon-left",
  IconRight = "btn-icon-right",
  Text = "btn-text",
}

interface ButtonVariantOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  content?: ButtonContent;
  disabled?: boolean;
  className?: string;
}

/** NAC's `btn-*` classes, in the call shape shadcn parts expect from `buttonVariants`. */
function buttonVariants({
  variant = ButtonVariant.Ghost,
  size = ButtonSize.Medium,
  content = ButtonContent.Text,
  disabled = false,
  className,
}: ButtonVariantOptions = {}): string {
  return cn("btn", size, variant, content, disabled && "btn-disabled", className);
}

type ButtonProps = React.ComponentProps<"button"> &
  Omit<ButtonVariantOptions, "className"> & {
    asChild?: boolean;
  };

/** A plain button defaults to `type="button"`: NAC forms submit through their own handlers. */
function Button({
  variant,
  size,
  content,
  disabled,
  className,
  asChild = false,
  type = "button",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      disabled={disabled}
      className={buttonVariants({ variant, size, content, disabled, className })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
