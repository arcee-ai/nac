import type React from "react";
import { type IconName } from "../icon";
export declare enum HorizontalTabsItemSize {
    Small = "btn-small",
    Medium = "btn-medium",
    Large = "btn-large"
}
export declare enum HorizontalTabsItemContent {
    IconLeft = "horizontal-tab-item-icon-left",
    IconRight = "horizontal-tab-item-icon-right",
    IconOnly = "horizontal-tab-item-icon",
    TextOnly = "horizontal-tab-item-text",
    Full = "horizontal-tab-item-full"
}
interface HorizontalTabsItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    size?: HorizontalTabsItemSize;
    /** Layout of the label and icons. Omitted, it follows whichever icons are set. */
    content?: HorizontalTabsItemContent;
    iconName?: IconName;
    trailingIcon?: IconName;
}
declare const HorizontalTabsItem: React.FC<HorizontalTabsItemProps> & {
    Size: typeof HorizontalTabsItemSize;
    Content: typeof HorizontalTabsItemContent;
};
export default HorizontalTabsItem;
