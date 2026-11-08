export interface DesktopVisibilityPort {
    connectVisibility?(owner: (visible: boolean) => void): () => void;
}
export declare const DesktopVisibilityContext: import("react").Context<boolean>;
export declare const useDesktopVisible: () => boolean;
