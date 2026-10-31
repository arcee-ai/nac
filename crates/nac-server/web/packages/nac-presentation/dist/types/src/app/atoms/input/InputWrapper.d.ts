import type React from "react";
import { type HoverHintConfig } from "../label";
export interface InputWrapperProps {
    label?: React.ReactNode;
    required?: boolean;
    validation?: boolean;
    validationText?: string;
    hintText?: string;
    /** Large fields use a 14px caption. Compact fields use 12px. */
    caption?: "large" | "compact";
    /** Info glyph beside the label, for the explanation that will not fit inline. */
    hoverHint?: HoverHintConfig;
    /** Id of the control the label names. */
    htmlFor?: string;
    /** Id of the hint / validation line, for the control's `aria-describedby`. */
    descriptionId?: string;
    className?: string;
    children?: React.ReactNode;
}
/** Label, required marker and hint / validation line around a form control. */
declare const InputWrapper: React.FC<InputWrapperProps>;
export default InputWrapper;
