import type { SessionBehavior } from "../../types/api";
import type { InheritedModel, ModelOverride } from "./modelChoice";
/**
 * The composer's model chip, opened: a model from the connected providers and
 * its reasoning effort, applied to this one session without touching the
 * project default. Accounts, keys and presets live in Settings.
 */
export declare function ModelOverrideModal({ open, behavior, inherited, inheritancePending, inheritanceError, current, overridden, onApply, onReset, onClose, }: {
    open: boolean;
    behavior: SessionBehavior;
    inherited: InheritedModel | null;
    inheritancePending: boolean;
    inheritanceError: Error | null;
    current: ModelOverride | null;
    /** The user picked `current` themselves, rather than it being a default. */
    overridden: boolean;
    onApply: (override: ModelOverride) => void;
    onReset: () => void;
    onClose: () => void;
}): import("react").JSX.Element | null;
