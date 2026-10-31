import type { ComponentProps, FormHTMLAttributes, ReactNode } from "react";

import { Button, ButtonContent, ButtonSize } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * The ground fades in under a 656px column of controls, so the transcript
 * scrolls out beneath the composer instead of stopping at a card edge. Only
 * the controls take the pointer; the faded margin lets it through.
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
        "pointer-events-none flex flex-col items-center gap-4 py-4 [&>*]:pointer-events-auto [&>*]:w-full [&>*]:max-w-[656px]",
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

/**
 * The level-1 card both composers share: the field row over the session
 * controls. A focused field draws a hairline inside the edge, in the border
 * token `outline` names, and the goal editor washes the whole card in accent.
 * Rows that should paint over the wash are `relative`.
 */
export function ComposerCard({
  compact,
  surface,
  outline = "muted",
  className,
  children,
}: {
  compact: boolean;
  surface?: "focus" | "goal";
  outline?: "muted" | "tertiary";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-4 bg-elevation-level-1 pb-4 shadow-xl",
        compact ? "rounded-[24px] px-1 pt-1" : "rounded-[32px] px-2 pt-2",
        className,
      )}
    >
      {surface ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit]",
            surface === "goal"
              ? "bg-accent-primary"
              : outline === "tertiary"
                ? "border border-tertiary"
                : "border border-muted",
          )}
        />
      ) : null}
      {children}
    </div>
  );
}

/** The 48px place beside Send that an inline control takes, 40px tall on a phone. */
export function ComposerInlineSlot({
  compact,
  children,
}: {
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center",
        compact ? "h-10 w-12" : "size-12 px-1",
      )}
    >
      {children}
    </div>
  );
}

/**
 * A 36px circle around a 20px glyph, for the controls that ride inside the
 * card: the goal flag, Close and a subagent's Stop. `.btn` sets the radius
 * unlayered, hence `!`.
 */
export function ComposerInlineButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "content">) {
  return (
    <Button
      size={ButtonSize.Medium}
      content={ButtonContent.Icon}
      className={cn("shrink-0 !rounded-full", className)}
      {...props}
    />
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
