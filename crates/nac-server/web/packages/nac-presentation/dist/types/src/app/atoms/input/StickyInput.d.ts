import type React from "react";
import { IconName } from "../icon";
import { InputLeading, InputTrailing } from "./index";
export declare enum StickyInputVariant {
    Default = "default",
    Search = "search"
}
interface StickyInputProps extends Omit<React.ComponentPropsWithRef<"input">, "size"> {
    variant?: StickyInputVariant;
    leading?: InputLeading;
    leadingOnClick?: () => void;
    trailing?: InputTrailing;
    trailingOnClick?: () => void;
    leadingIconName?: IconName;
    trailingIconName?: IconName;
    inputClassName?: string;
    /** Applied to the elevated wrapper rather than the field itself. */
    className?: string;
    rounded?: boolean;
    isDisabled?: boolean;
    validation?: boolean;
    /** Search variant only: clears the field through its trailing button. */
    onClear?: () => void;
}
declare const StickyInput: React.FC<StickyInputProps> & {
    Variant: typeof StickyInputVariant;
    Leading: typeof InputLeading;
    Trailing: typeof InputTrailing;
};
export default StickyInput;
