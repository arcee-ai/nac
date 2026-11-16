import type { ReactNode } from "react";
import { ButtonContent, ButtonVariant } from "../../atoms";
/**
 * A footer action: a sticky pill on mobile, a large button on desktop.
 * The variant is the one the caller asked for on both sizes.
 */
export declare function FooterButton({ isMobile, variant, content, className, disabled, onClick, children, ariaLabel, }: {
    isMobile: boolean;
    variant: ButtonVariant;
    content?: ButtonContent;
    className?: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
    ariaLabel?: string;
}): import("react").JSX.Element;
