import type React from "react";
export declare enum SwitchSize {
    Medium = "medium",
    Large = "large"
}
interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "size"> {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    /** A phone wants the larger track, which is easier to hit with a thumb. */
    size?: SwitchSize;
}
/** Track/knob toggle on the input switcher tokens. */
declare const Switch: React.FC<SwitchProps>;
export default Switch;
