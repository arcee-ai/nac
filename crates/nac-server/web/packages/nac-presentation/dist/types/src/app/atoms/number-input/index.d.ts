import React from "react";
import { InputSize } from "../input";
interface NumberInputProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    size?: InputSize;
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
}
/**
 * Stepper for a bounded number. Typing is free-form until blur or Enter, so a
 * half-written value like "1" on the way to "12" is not clamped mid-keystroke.
 */
declare const NumberInput: React.FC<NumberInputProps>;
export default NumberInput;
