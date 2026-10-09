import { type ReactNode } from "react";
import { type ConfigurationsPanelInitial, type LaunchModelSelection } from "../../components/modals/ConfigurationsPanel";
/** Switching presentations preserves the full tuple without matching presets by model alone. */
export declare function ModelSetupSection({ initial, onChange, invalid, errorText, children, simple, inheritSavedDefault, existingSession, }: {
    initial?: ConfigurationsPanelInitial;
    onChange: (selection: LaunchModelSelection | null, source: "primary" | "preset") => void;
    invalid: boolean;
    errorText?: string;
    children?: ReactNode;
    simple?: boolean;
    inheritSavedDefault?: boolean;
    existingSession?: boolean;
}): import("react").JSX.Element;
