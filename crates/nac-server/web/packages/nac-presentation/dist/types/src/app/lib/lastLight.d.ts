import type { LightModelSettings } from "../types/api";
export declare function createLastLight(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    loadLastLight: () => LightModelSettings | null;
    storeLastLight: (light: LightModelSettings | null) => void;
};
export declare const release: () => void, loadLastLight: () => LightModelSettings | null, storeLastLight: (light: LightModelSettings | null) => void;
