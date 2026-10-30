import type { ComponentProps, FormHTMLAttributes, ReactNode } from "react";
import { Button } from "../../../atoms";
/**
 * The ground fades in under a 656px column of controls, so the transcript
 * scrolls out beneath the composer instead of stopping at a card edge. Only
 * the controls take the pointer; the faded margin lets it through.
 */
export declare function ComposerFrame({ compact, faded, className, children, ...form }: FormHTMLAttributes<HTMLFormElement> & {
    compact: boolean;
    faded?: boolean;
}): import("react").JSX.Element;
/**
 * The level-1 card both composers share: the field row over the session
 * controls. A focused field draws a hairline inside the edge, in the border
 * token `outline` names, and the goal editor washes the whole card in accent.
 * Rows that should paint over the wash are `relative`.
 */
export declare function ComposerCard({ compact, surface, outline, className, children, }: {
    compact: boolean;
    surface?: "focus" | "goal";
    outline?: "muted" | "tertiary";
    className?: string;
    children: ReactNode;
}): import("react").JSX.Element;
/** The 48px place beside Send that an inline control takes, 40px tall on a phone. */
export declare function ComposerInlineSlot({ compact, children, }: {
    compact: boolean;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * A 36px circle around a 20px glyph, for the controls that ride inside the
 * card: the goal flag, Close and a subagent's Stop. `.btn` sets the radius
 * unlayered, hence `!`.
 */
export declare function ComposerInlineButton({ className, ...props }: Omit<ComponentProps<typeof Button>, "size" | "content">): import("react").JSX.Element;
type ComposerIconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "content"> & {
    compact: boolean;
};
/** A 48px circle around a 24px glyph, or a 40px one on a phone. */
export declare function ComposerIconButton({ compact, className, ...props }: ComposerIconButtonProps): import("react").JSX.Element;
export {};
