import type { ManagedTab } from "../model";
/**
 * Which part of Settings › Managed host is open, and what finishing GitHub
 * device authorization should resume. The host provider owns it so "Add
 * repository" can send the user to GitHub and come back to the repository
 * dialog once connected.
 */
export interface ManagedSettingsState {
    tab: ManagedTab;
    setTab(tab: ManagedTab): void;
    onGitHubConnected(): void;
}
export declare const ManagedSettingsContext: import("react").Context<ManagedSettingsState | null>;
export declare function useManagedSettings(): ManagedSettingsState | null;
