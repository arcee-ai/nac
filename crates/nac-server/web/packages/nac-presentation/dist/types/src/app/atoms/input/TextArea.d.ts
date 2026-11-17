import type React from "react";
/** Utilities rather than `.input-*` rules, so callers can still override height and type. */
export declare enum TextAreaSize {
    Small = "h-[93px] p-1 text-micro",
    Medium = "h-[86px] p-2 text-small",
    Large = "h-[120px] p-3 text-medium"
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
