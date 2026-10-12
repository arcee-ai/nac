import type React from "react";
import { AnchorPlacement } from "../../lib/anchor";
export declare enum HoverHintSize {
    Small = 16,
    Medium = 20,
    Large = 24
}
interface HoverHintProps {
    title: string;
    description?: string;
    size?: HoverHintSize;
    position?: AnchorPlacement;
    className?: string;
    /** Quieter glyph. Overrides the fill buttons apply to every icon. */
    muted?: boolean;
}
/** Info glyph that explains a nearby control on hover. */
declare const HoverHint: React.FC<HoverHintProps> & {
    Size: typeof HoverHintSize;
};
export default HoverHint;
