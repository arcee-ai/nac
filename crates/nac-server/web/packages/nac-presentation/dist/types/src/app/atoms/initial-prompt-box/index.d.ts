import type React from "react";
import { type IconName } from "../icon";
interface InitialPromptBoxProps {
    icon: IconName;
    title: string;
    /** The prompt itself, clamped to the two lines the box has room for. */
    description: string;
    onClick: () => void;
    className?: string;
}
/**
 * Card offering one ready-made prompt: a hairline card whose hover and press
 * washes sit on a layer above its surface, so both read in light and dark.
 */
declare const InitialPromptBox: React.FC<InitialPromptBoxProps>;
export default InitialPromptBox;
