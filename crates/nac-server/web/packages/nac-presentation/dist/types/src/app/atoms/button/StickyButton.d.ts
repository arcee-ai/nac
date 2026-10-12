import type React from "react";
import { ButtonContent, ButtonVariant } from "./index";
interface StickyButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
    variant?: ButtonVariant;
    content?: ButtonContent;
    children: React.ReactNode;
    loading?: boolean;
    /** Applied to the elevated wrapper rather than the button itself. */
    className?: string;
    buttonClassName?: string;
}
declare const StickyButton: React.FC<StickyButtonProps> & {
    Variant: typeof ButtonVariant;
    Content: typeof ButtonContent;
};
export default StickyButton;
