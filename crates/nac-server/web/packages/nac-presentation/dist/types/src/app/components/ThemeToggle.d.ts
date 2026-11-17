import { ButtonSize } from "../atoms";
/** One quiet icon button that cycles System → Light → Dark. */
export declare function ThemeToggle({ size }: {
    size?: ButtonSize;
}): import("react").JSX.Element;
/** System / Light / Dark as a segmented control (Settings › Appearance). */
export declare function ThemeSegmented({ className }: {
    className?: string;
}): import("react").JSX.Element;
