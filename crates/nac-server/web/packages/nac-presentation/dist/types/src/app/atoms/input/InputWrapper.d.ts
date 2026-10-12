import type React from "react";
import { type HoverHintConfig } from "../label";
export interface InputWrapperProps {
    label?: React.ReactNode;
    required?: boolean;
    validation?: boolean;
    validationText?: string;
    hintText?: string;
    /** Info glyph beside the label, for the explanation that will not fit inline. */
    hoverHint?: HoverHintConfig;
    className?: string;
    children?: React.ReactNode;
}
/** Label, required marker and hint / validation line around a form control. */
declare const InputWrapper: React.FC<InputWrapperProps>;
export default InputWrapper;
