import { type ReactNode } from "react";
import type { SessionModelInitial, LaunchModelSelection } from "./modelSelection";
/** A session chooses its model; provider connections are shared separately. */
export declare function ModelSetupSection({ initial, onChange, errorText, children, existingSession, }: {
    initial?: SessionModelInitial;
    onChange: (selection: LaunchModelSelection | null) => void;
    invalid: boolean;
    errorText?: string;
    children?: ReactNode;
    existingSession?: boolean;
}): import("react").JSX.Element;
