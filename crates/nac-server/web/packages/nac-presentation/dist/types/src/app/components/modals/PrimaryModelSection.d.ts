import { type ConfigurationsPanelInitial, type LaunchModelSelection } from "./ConfigurationsPanel";
/**
 * The ordinary primary-model control: one catalog spanning every configured
 * provider. Provider connection and advanced presets intentionally live
 * outside this component.
 */
export declare function PrimaryModelSection({ initial: suppliedInitial, inheritSavedDefault, existingSession, onChange, }: {
    initial?: ConfigurationsPanelInitial;
    inheritSavedDefault?: boolean;
    existingSession?: boolean;
    onChange: (selection: LaunchModelSelection | null) => void;
}): import("react").JSX.Element;
