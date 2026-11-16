import type { SettingsSection } from "../../lib/routes";
/**
 * Settings destinations. Each one navigates to its Settings section; nothing
 * here opens a dialog any more.
 */
export interface ProductNavigationOwner {
    openMcp(): void;
    openConfigurations(): void;
    openSsh(): void;
    /** Settings › Capabilities, scoped to the session on screen (if any). */
    inspect(): void;
    openSettings(section?: SettingsSection): void;
}
export declare const ProductNavigationContext: import("react").Context<ProductNavigationOwner | null>;
export declare function useProductNavigationOwner(): ProductNavigationOwner;
