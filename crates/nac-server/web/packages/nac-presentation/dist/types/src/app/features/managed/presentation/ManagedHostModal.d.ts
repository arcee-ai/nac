import { type ManagedTab } from "../model.js";
export declare function ManagedHostModal({ open, onClose, tab, onTabChange, onGitHubConnected, }: {
    open: boolean;
    onClose: () => void;
    tab: ManagedTab;
    onTabChange: (tab: ManagedTab) => void;
    onGitHubConnected?: () => void;
}): import("react").JSX.Element;
