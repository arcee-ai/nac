import type { SelectItem } from "../atoms";
import type { ProviderModel } from "../types/api";
/** Long enough to stop firing on every keystroke of a pasted key. */
export declare const KEY_DEBOUNCE_MS = 600;
/** Stored keys never leave the server, so a saved setup only shows a stand-in. */
export declare const MASKED_KEY: string;
export declare function isGeneratedCredentialName(name: string): boolean;
export type Validation = {
    status: "idle";
} | {
    status: "validating";
} | {
    status: "ready";
    models: ProviderModel[];
    baseUrl: string;
} | {
    status: "error";
    message: string;
};
export declare function modelItems(models: ProviderModel[]): SelectItem[];
