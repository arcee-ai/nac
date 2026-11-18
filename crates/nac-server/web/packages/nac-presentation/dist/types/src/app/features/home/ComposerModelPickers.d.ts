import type { BackendKind, ReasoningEffort } from "../../types/api";
import type { ModelOverride } from "./modelChoice";
/**
 * The composer's model chip, "GPT-6.1 Sol High": the model this session runs
 * on and its reasoning effort. Opens on an overview of both; each row leads to
 * its own list. Lists every model on a connected provider; accounts and keys
 * are added in Settings.
 */
export declare function ModelPicker({ fallbackLabel, pending, value, effort, supportedEfforts, inheritedLabel, usingInherited, disabled, onPick, onEffort, onUseInherited, onAdvanced, }: {
    /** Shown when the model is not in the catalog (an older saved setup). */
    fallbackLabel: string | null;
    pending: boolean;
    value: {
        backend: BackendKind;
        model: string;
    } | null;
    /** "" is the model's own default. */
    effort: string;
    supportedEfforts: readonly ReasoningEffort[];
    /** The project's own model, offered as a way back after picking another. */
    inheritedLabel: string | null;
    usingInherited: boolean;
    disabled?: boolean;
    onPick: (override: ModelOverride) => void;
    onEffort: (effort: string) => void;
    onUseInherited: () => void;
    /** Light-model and preset options, where orchestration still offers them. */
    onAdvanced?: () => void;
}): import("react").JSX.Element;
