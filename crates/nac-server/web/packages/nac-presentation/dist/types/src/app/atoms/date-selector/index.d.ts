import React from "react";
import { ButtonSize } from "../button";
import { type InputWrapperProps } from "../input/InputWrapper";
import { PopoverPlacement } from "../popover";
/**
 * Values cross this boundary as `YYYY-MM-DD`, the same calendar-day form a
 * native date input uses. Anything with a time in it would drag a timezone
 * along and shift the day for users west of UTC.
 */
export type DateString = string;
export interface DateStringRange {
    from: DateString | null;
    to: DateString | null;
}
interface CommonProps extends Omit<InputWrapperProps, "children" | "validationText"> {
    size?: ButtonSize;
    disabled?: boolean;
    validationText?: string;
    placement?: PopoverPlacement;
    min?: DateString;
    max?: DateString;
    placeholder?: string;
}
interface SingleProps extends CommonProps {
    value: DateString | null;
    onChange: (value: DateString) => void;
    range?: never;
    onRangeChange?: never;
}
interface RangeProps extends CommonProps {
    value?: never;
    onChange?: never;
    range: DateStringRange;
    onRangeChange: (range: DateStringRange) => void;
}
type DateSelectorProps = SingleProps | RangeProps;
/** Calendar behind a field-shaped trigger, closing once the value is complete. */
declare const DateSelector: React.FC<DateSelectorProps>;
export default DateSelector;
