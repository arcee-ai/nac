import type { SessionBehavior } from "../../types/api";
import type { InheritedModel, ModelOverride } from "./modelChoice";
/**
 * The composer's model chip, opened: the same model setup the old New Chat
 * dialog had (unified catalog, provider connections, advanced presets, light
 * model), applied to this one session without touching the project default.
 */
export declare function ModelOverrideModal({ open, behavior, inherited, inheritancePending, inheritanceError, current, onApply, onReset, onClose, }: {
    open: boolean;
    behavior: SessionBehavior;
    inherited: InheritedModel | null;
    inheritancePending: boolean;
    inheritanceError: Error | null;
    current: ModelOverride | null;
    onApply: (override: ModelOverride) => void;
    onReset: () => void;
    onClose: () => void;
}): import("react").JSX.Element | null;
