/**
 * Manages the saved provider setups: the sidebar picks one, the form edits it
 * in place, and the footer saves, discards or removes it.
 *
 * Remounted on every open so a half-finished edit never survives a close.
 */
export declare function ConfigurationsModal({ open, onClose }: {
    open: boolean;
    onClose: () => void;
}): import("react").JSX.Element | null;
