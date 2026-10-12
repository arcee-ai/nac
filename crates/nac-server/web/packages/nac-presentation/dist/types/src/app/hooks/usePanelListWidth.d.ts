export declare const PANEL_LIST_MIN_WIDTH = 180;
export declare const PANEL_LIST_DEFAULT_WIDTH = 208;
export declare const PANEL_LIST_MAX_RATIO = 0.75;
export declare function createPanelWidth(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    clampPanelListWidth: (next: number, maxWidth: number) => number;
    setPanelListWidth: (next: number) => void;
    usePanelListWidth: () => number;
};
export declare const release: () => void, clampPanelListWidth: (next: number, maxWidth: number) => number, setPanelListWidth: (next: number) => void, usePanelListWidth: () => number;
