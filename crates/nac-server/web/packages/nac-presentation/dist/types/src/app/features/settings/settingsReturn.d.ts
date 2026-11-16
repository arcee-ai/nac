import { type RefObject } from "react";
/** The last place outside Settings, kept by `SettingsReturnProvider`. */
export declare const SettingsReturnContext: import("react").Context<RefObject<string | null> | null>;
/**
 * Settings' ← Back: return to wherever the user was before Settings took over
 * the window, or Home when they arrived on a Settings link directly.
 */
export declare function useSettingsReturn(): () => void;
