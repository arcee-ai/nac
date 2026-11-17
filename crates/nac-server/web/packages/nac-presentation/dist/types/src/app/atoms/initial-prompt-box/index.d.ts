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
 * Card offering one ready-made prompt. The elevation sits on the card while the
 * ghost tokens paint hover and press on a layer above it, which is how the
 * design stacks them — a single background could not carry both.
 */
declare const InitialPromptBox: React.FC<InitialPromptBoxProps>;
export default InitialPromptBox;
