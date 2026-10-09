import type React from "react";
interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked"> {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    children?: React.ReactNode;
}
/** Square toggle for a single boolean, with the label as its own hit area. */
declare const Checkbox: React.FC<CheckboxProps>;
export default Checkbox;
