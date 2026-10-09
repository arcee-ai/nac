import React from "react";
import { IconName } from "../icon";
export declare enum InputSize {
    Small = "input-small",
    Medium = "input-medium",
    Large = "input-large"
}
export declare enum InputLeading {
    None = "none",
    Icon = "icon",
    Button = "button"
}
export declare enum InputTrailing {
    None = "none",
    Icon = "icon",
    Button = "button"
}
interface InputProps extends Omit<React.ComponentPropsWithRef<"input">, "size"> {
    inputSize?: InputSize;
    leading?: InputLeading;
    leadingOnClick?: () => void;
    /** Occupies the leading slot with arbitrary content, e.g. a status glyph. */
    leadingSlot?: React.ReactNode;
    trailing?: InputTrailing;
    trailingOnClick?: () => void;
    leadingIconName?: IconName;
    trailingIconName?: IconName;
    inputClassName?: string;
    label?: React.ReactNode;
    required?: boolean;
    rounded?: boolean;
    isDisabled?: boolean;
    validation?: boolean;
    validationText?: string;
    hintText?: string;
}
declare const Input: React.FC<InputProps> & {
    Size: typeof InputSize;
    Leading: typeof InputLeading;
    Trailing: typeof InputTrailing;
};
export default Input;
