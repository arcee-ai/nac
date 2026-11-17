/** One presentation owns the lifetime and identity of its deferred return. */
export declare function createSettingsReturnOwner(): {
    origin: () => string | null;
    activate: () => void;
    deactivate: () => void;
    location: (location: string, isSettings: boolean) => void;
    begin: (destination: string) => {
        destination: string;
    };
    current: (request: {
        destination: string;
    }) => boolean;
    retire: (request: {
        destination: string;
    }) => void;
};
export declare const SettingsReturnContext: import("react").Context<{
    origin: () => string | null;
    activate: () => void;
    deactivate: () => void;
    location: (location: string, isSettings: boolean) => void;
    begin: (destination: string) => {
        destination: string;
    };
    current: (request: {
        destination: string;
    }) => boolean;
    retire: (request: {
        destination: string;
    }) => void;
} | null>;
/**
 * Settings' ← Back: return to wherever the user was before Settings took over
 * the window, or Home when they arrived on a Settings link directly.
 */
export declare function useSettingsReturn(): () => void;
