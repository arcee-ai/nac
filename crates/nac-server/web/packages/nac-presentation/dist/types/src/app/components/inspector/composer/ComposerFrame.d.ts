import type { ComponentProps, FormHTMLAttributes, ReactNode } from "react";
import { Button } from "../../../atoms";
/**
 * The ground fades in under a 640px column of controls, so the transcript
 * scrolls out beneath the composer instead of stopping at a card edge. Only the
 * controls take the pointer; the faded margin lets it through.
 */
export declare function ComposerFrame({ compact, faded, className, children, ...form }: FormHTMLAttributes<HTMLFormElement> & {
    compact: boolean;
    faded?: boolean;
}): import("react").JSX.Element;
/** The level-3 pill around the field and the buttons that ride inside it. */
export declare function ComposerPill({ compact, outline, className, children, }: {
    compact: boolean;
    /** A 2px ring inside the edge: the focused field, or the goal editor's. */
    outline?: "focus" | "accent";
    className?: string;
    children: ReactNode;
}): import("react").JSX.Element;
type ComposerIconButtonProps = Omit<ComponentProps<typeof Button>, "size" | "content"> & {
    compact: boolean;
};
/** A 48px circle around a 24px glyph, or a 40px one on a phone. */
export declare function ComposerIconButton({ compact, className, ...props }: ComposerIconButtonProps): import("react").JSX.Element;
/**
 * Send stands outside the pill on a shadow of its own, which replaces the
 * primary fill's convex one; that unlayered rule beats a plain utility.
 */
export declare function ComposerSendButton({ className, ...props }: Omit<ComposerIconButtonProps, "variant">): import("react").JSX.Element;
export {};
