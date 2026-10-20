import type React from "react";
export declare enum TextAreaSize {
    Small = "input-small",
    Medium = "input-medium",
    Large = "input-large"
}
interface TextAreaProps extends Omit<React.ComponentPropsWithRef<"textarea">, "size"> {
    textAreaSize?: TextAreaSize;
    label?: React.ReactNode;
    required?: boolean;
    isDisabled?: boolean;
    validation?: boolean;
    validationText?: string;
    hintText?: string;
    textAreaClassName?: string;
}
/** Multi-line counterpart of `Input`, sharing its chrome and validation line. */
declare const TextArea: React.FC<TextAreaProps> & {
    Size: typeof TextAreaSize;
};
export default TextArea;
