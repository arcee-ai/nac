import type React from "react";
import { IconName } from "../icon";
export declare enum LabelSize {
    Micro = "label-micro",
    Small = "label-small",
    Medium = "label-medium"
}
export interface HoverHintConfig {
    title: string;
    description?: string;
    /** Quieter glyph. Needed inside buttons, which paint every icon. */
    muted?: boolean;
}
interface LabelProps {
    children: React.ReactNode;
    htmlFor?: string;
    size?: LabelSize;
    icon?: IconName;
    /** Renders in the error colour, to match a field failing validation. */
    validation?: boolean;
    tone?: "primary" | "secondary" | "muted";
    hoverHint?: HoverHintConfig;
    className?: string;
}
/** Field caption with an optional leading glyph and an explanatory hint. */
declare const Label: React.FC<LabelProps> & {
    Size: typeof LabelSize;
};
export default Label;
