import type { ComponentProps, FormHTMLAttributes, ReactNode } from "react";

import { Button, ButtonContent, ButtonSize, ButtonVariant } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * The ground fades in under a 640px column of controls, so the transcript
 * scrolls out beneath the composer instead of stopping at a card edge. Only the
 * controls take the pointer; the faded margin lets it through.
 */
export function ComposerFrame({
  compact,
  faded = true,
  className,
  children,
  ...form
}: FormHTMLAttributes<HTMLFormElement> & { compact: boolean; faded?: boolean }) {
  return (
    <form
      className={cn(
        "pointer-events-none flex flex-col items-center gap-4 pt-4 pb-8 [&>*]:pointer-events-auto [&>*]:w-full [&>*]:max-w-[640px]",
        compact ? "px-2" : "px-4",
        faded && "fade-from-bottom",
        className,
      )}
      {...form}
    >
      {children}
    </form>
  );
}

/** The level-3 pill around the field and the buttons that ride inside it. */
export function ComposerPill({
  compact,
  outline,
  className,
  children,
}: {
  compact: boolean;
  /** A 2px ring inside the edge: the focused field, or the goal editor's. */
  outline?: "focus" | "accent";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 items-end bg-elevation-level-3 shadow-xl",
        compact ? "rounded-[20px]" : "rounded-[24px]",
        className,
      )}
    >
      {children}
      {outline ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] border-2",
            outline === "accent" ? "border-accent-primary" : "border-tertiary",
          )}
        />
      ) : null}
    </div>
  );
}

type ComposerIconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "content"> & {
  compact: boolean;
};

/** A 48px circle around a 24px glyph, or a 40px one on a phone. */
export function ComposerIconButton({ compact, className, ...props }: ComposerIconButtonProps) {
  return (
    <Button
      size={compact ? ButtonSize.Medium : ButtonSize.Large}
      content={ButtonContent.Icon}
      className={cn("btn-round shrink-0", className)}
      {...props}
    />
  );
}

/**
 * Send stands outside the pill on its own shadow. The wrapper carries it: the
 * primary fill's convex shadow would win over a utility on the button itself.
 */
export function ComposerSendButton({
  className,
  ...props
}: Omit<ComposerIconButtonProps, "variant">) {
  return (
    <span className={cn("inline-flex shrink-0 rounded-full shadow-xl", className)}>
      <ComposerIconButton variant={ButtonVariant.Primary} {...props} />
    </span>
  );
}
