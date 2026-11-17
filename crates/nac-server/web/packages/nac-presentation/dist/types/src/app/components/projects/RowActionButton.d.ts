import { type IconName } from "../../atoms";
/**
 * One control at the end of a list row. Phone controls keep a 44px target;
 * desktop controls retain the compact row's existing size.
 */
export declare function RowActionButton({ icon, label, title, isMobile, destructive, onClick, }: {
    icon: IconName;
    label: string;
    title?: string;
    isMobile?: boolean;
    destructive?: boolean;
    onClick: () => void;
}): import("react").JSX.Element;
