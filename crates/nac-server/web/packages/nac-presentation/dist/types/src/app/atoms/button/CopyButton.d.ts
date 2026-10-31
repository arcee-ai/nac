import type React from "react";
import { AnchorPlacement } from "../../lib/anchor";
import { ButtonContent, ButtonSize, ButtonVariant } from "./index";
interface CopyButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
    /** Text placed on the clipboard when the button is pressed. */
    value: string;
    size?: ButtonSize;
    variant?: ButtonVariant;
    content?: ButtonContent;
    position?: AnchorPlacement;
    /** Label shown in the tooltip before anything is copied. */
    title?: string;
    /** Pixel size of the default copy/check glyph; the Icon atom's default when omitted. */
    iconSize?: number;
    onCopy?: () => void;
    children?: React.ReactNode;
}
/** Copies a string and acknowledges it in the tooltip for a couple of seconds. */
declare const CopyButton: React.FC<CopyButtonProps>;
export default CopyButton;
