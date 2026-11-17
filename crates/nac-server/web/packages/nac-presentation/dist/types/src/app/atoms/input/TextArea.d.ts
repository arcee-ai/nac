import type React from "react";
/** Utilities rather than `.input-*` rules, so callers can still override height and type. */
export declare enum TextAreaSize {
    Small = "h-[92px] px-2 py-1.5 type-meta",
    Medium = "h-[88px] px-2.5 py-2 type-body-chrome",
    Large = "h-[120px] px-3 py-2.5 text-md"
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
