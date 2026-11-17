import { type ReactNode } from "react";
import { IconName } from "../../atoms";
/**
 * A composer chip: a quiet pill that names one choice and opens its picker.
 * 32px on desktop, 44px on phones.
 */
export declare const Chip: import("react").ForwardRefExoticComponent<Omit<import("react").DetailedHTMLProps<import("react").ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, "ref"> & {
    icon?: IconName;
    leading?: ReactNode;
    /** Draws the trailing disclosure chevron. */
    menu?: boolean;
    pressed?: boolean;
} & import("react").RefAttributes<HTMLButtonElement>>;
