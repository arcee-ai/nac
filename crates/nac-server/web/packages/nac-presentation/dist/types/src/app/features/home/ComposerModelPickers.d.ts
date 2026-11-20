import { PopoverPlacement } from "../../atoms";
import { type CatalogPick } from "../../lib/catalog";
import { type ServiceTier, type speedForRoute } from "../../lib/serviceTier";
import type { BackendKind, ModelCatalog, ReasoningEffort } from "../../types/api";
type CatalogProvider = ModelCatalog["providers"][number];
/**
 * One composer control for model, reasoning and speed. The current model
 * opens the searchable catalog; the overview exposes the capabilities of
 * just that model and route.
 */
export declare function ModelPicker({ fallbackLabel, pending, value, effort, supportedEfforts, speed, disabled, placement, usableProvider, onPick, onEffort, onAdvanced, }: {
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
    speed?: ReturnType<typeof speedForRoute> & {
        value: ServiceTier | null;
        onChange: (tier: ServiceTier | null) => void;
    };
    disabled?: boolean;
    placement?: PopoverPlacement;
    /** Whose models are listed: connected providers unless a host mounts its own. */
    usableProvider?: (provider: CatalogProvider) => boolean;
    /** Rejected selections keep the model list open with an explanation. */
    onPick: (pick: CatalogPick, clearIncompatibleSpeed: boolean) => {
        error: string;
        confirmSpeedClear?: boolean;
    } | {
        notice: string;
    } | void;
    onEffort: (effort: string) => void;
    /** Light-model and preset options, where orchestration still offers them. */
    onAdvanced?: () => void;
}): import("react").JSX.Element;
export {};
