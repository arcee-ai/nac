import type React from "react";
interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked"> {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    children?: React.ReactNode;
}
/**
 * One option out of a set. Give every radio in a group the same `name` so the
 * browser handles arrow-key navigation between them.
 */
declare const Radio: React.FC<RadioProps>;
export default Radio;
