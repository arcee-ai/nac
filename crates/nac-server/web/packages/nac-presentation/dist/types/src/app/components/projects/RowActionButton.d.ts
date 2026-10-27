import { type IconName } from "../../atoms";
/**
 * One control at the end of a list row. A phone row draws a bare 20px glyph
 * 12px from its neighbour; the box keeps that size, and an invisible margin
 * around it takes the target to 32px without reaching the next one.
 */
export declare function RowActionButton({ icon, label, title, isMobile, destructive, onClick, }: {
    icon: IconName;
    label: string;
    title?: string;
    isMobile?: boolean;
    destructive?: boolean;
    onClick: () => void;
}): import("react").JSX.Element;
