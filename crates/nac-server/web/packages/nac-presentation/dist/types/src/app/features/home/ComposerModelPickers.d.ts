import { PopoverPlacement } from "../../atoms";
import { type CatalogPick } from "../../lib/catalog";
import type { BackendKind, ModelCatalog, ReasoningEffort } from "../../types/api";
type CatalogProvider = ModelCatalog["providers"][number];
/**
 * The composer's model chip, "GPT-6.1 Sol High": the model a session runs on
 * and its reasoning effort, on Home and in a session. Opens on an overview of
 * both; each row leads to its own list. Lists every model on a connected
 * provider; accounts and keys are added in Settings.
 */
export declare function ModelPicker({ fallbackLabel, pending, value, effort, supportedEfforts, inheritedLabel, usingInherited, disabled, placement, usableProvider, onPick, onEffort, onUseInherited, onAdvanced, }: {
    /** Shown when the model is not in the catalog (an older saved setup). */
    fallbackLabel: string | null;
    pending: boolean;
    value: {
        backend: BackendKind;
        model: string;
    } | null;
    /** A reasoning level; "" only while there is no model. */
    effort: string;
    supportedEfforts: readonly ReasoningEffort[];
    /** The project's own model, offered as a way back after picking another. */
    inheritedLabel?: string | null;
    usingInherited?: boolean;
    disabled?: boolean;
    placement?: PopoverPlacement;
    /** Whose models are listed: connected providers unless a host mounts its own. */
    usableProvider?: (provider: CatalogProvider) => boolean;
    onPick: (pick: CatalogPick) => void;
    onEffort: (effort: string) => void;
    onUseInherited?: () => void;
    /** Light-model and preset options, where orchestration still offers them. */
    onAdvanced?: () => void;
}): import("react").JSX.Element;
export {};
