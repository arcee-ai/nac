import type React from "react";
export declare enum SwitchSize {
    /** Figma Small: 32×16 track, 12px knob. */
    Medium = "medium",
    /** Figma Regular: 40×20 track, 16px knob. A phone wants this larger hit area. */
    Large = "large"
}
interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "size"> {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    size?: SwitchSize;
}
/** Track and knob toggle. Sizes and tokens follow the Figma Switcher. */
declare const Switch: React.FC<SwitchProps>;
export default Switch;
