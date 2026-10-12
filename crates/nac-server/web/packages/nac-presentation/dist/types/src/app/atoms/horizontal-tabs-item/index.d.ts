import type React from "react";
import { type IconName } from "../icon";
export declare enum HorizontalTabsItemVariant {
    Accent = "accent",
    Neutral = "neutral"
}
interface HorizontalTabsItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    iconName?: IconName;
    variant?: HorizontalTabsItemVariant;
}
/** Horizontal tab item with an underline for the active state. */
declare const HorizontalTabsItem: React.FC<HorizontalTabsItemProps> & {
    Variant: typeof HorizontalTabsItemVariant;
};
export default HorizontalTabsItem;
