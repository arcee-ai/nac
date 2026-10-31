import type React from "react";
import { ButtonContent, ButtonSize, ButtonVariant } from "../../ui/button";
import { LoaderVariant } from "../loader";
export { ButtonContent, ButtonSize, ButtonVariant };
interface ButtonProps extends React.ComponentPropsWithRef<"button"> {
    size?: ButtonSize;
    variant?: ButtonVariant;
    content?: ButtonContent;
    children: React.ReactNode;
    loading?: boolean;
}
export declare const loaderVariant: {
    "btn-primary": LoaderVariant;
    "btn-secondary": LoaderVariant;
    "btn-secondary-highlighted": LoaderVariant;
    "btn-secondary-destructive": LoaderVariant;
    "btn-secondary-accent": LoaderVariant;
    "btn-secondary-accent-highlighted": LoaderVariant;
    "btn-tertiary": LoaderVariant;
    "btn-tertiary-destructive": LoaderVariant;
    "btn-tertiary-accent": LoaderVariant;
    "btn-ghost": LoaderVariant;
    "btn-ghost-destructive": LoaderVariant;
    "btn-ghost-accent": LoaderVariant;
    "btn-ghost-highlighted": LoaderVariant;
    "btn-ghost-highlighted-accent": LoaderVariant;
};
declare const Button: React.FC<ButtonProps> & {
    Size: typeof ButtonSize;
    Variant: typeof ButtonVariant;
    Content: typeof ButtonContent;
};
export default Button;
