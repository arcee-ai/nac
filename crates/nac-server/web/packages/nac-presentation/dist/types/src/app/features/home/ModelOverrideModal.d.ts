import type { ModelOverride } from "./modelChoice";
/** Choose a model for the session being composed. */
export declare function ModelOverrideModal({ open, current, onApply, onReset, onClose, }: {
    open: boolean;
    current: ModelOverride | null;
    onApply: (override: ModelOverride) => void;
    onReset: () => void;
    onClose: () => void;
}): import("react").JSX.Element | null;
