import { type SessionModelInitial, type LaunchModelSelection } from "../../features/setup/modelSelection";
/**
 * The ordinary primary-model control: one catalog spanning every configured
 * provider. Provider connections live outside this component.
 */
export declare function PrimaryModelSection({ initial: suppliedInitial, existingSession, onChange, }: {
    initial?: SessionModelInitial;
    existingSession?: boolean;
    onChange: (selection: LaunchModelSelection | null) => void;
}): import("react").JSX.Element;
