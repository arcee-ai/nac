import { type ReactNode } from "react";
/** Width every control on the right-hand side of a row shares. */
export declare const CONTROL_WIDTH = "w-full md:w-[280px]";
export declare function FieldLabel({ label, hint, required, invalid, }: {
    label: string;
    hint?: string;
    /** Marks the field with the asterisk the form's footnote explains. */
    required?: boolean;
    invalid?: boolean;
}): import("react").JSX.Element;
/**
 * One line inside the Configurations box: label left, control right. With
 * `verticalOnMobile` a phone stacks the two instead, which is what a long label
 * next to a wide control needs to stay readable.
 */
export declare function ConfigRow({ label, hint, required, invalid, secondary, muted, verticalOnMobile, labelClassName, control, presentation, }: {
    label: string;
    hint?: string;
    /** Marks the field with the asterisk the box's footnote explains. */
    required?: boolean;
    invalid?: boolean;
    secondary?: boolean;
    /** Dims the label while the row is waiting on something else. */
    muted?: boolean;
    /** Stacks label over control on a phone instead of keeping them on one line. */
    verticalOnMobile?: boolean;
    /** Widens the label past the cap a narrow box needs, e.g. `max-w-none`. */
    labelClassName?: string;
    control: ReactNode;
    /** Opt-in readable form layout; legacy compact consumers keep their geometry. */
    presentation?: "form";
}): import("react").JSX.Element;
