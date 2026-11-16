export declare const PANEL_LIST_MIN_WIDTH = 180;
/** Floor of the width a list takes before the user resizes it. */
export declare const PANEL_LIST_DEFAULT_WIDTH = 208;
export declare const PANEL_LIST_DEFAULT_RATIO: number;
export declare const PANEL_LIST_MAX_RATIO = 0.75;
/** The list's share of a panel this wide until the user resizes it. */
export declare function defaultPanelListWidth(containerWidth: number): number;
export declare function createPanelWidth(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    clampPanelListWidth: (next: number, maxWidth: number) => number;
    setPanelListWidth: (next: number) => void;
    usePanelListWidth: () => number | null;
};
export declare const release: () => void, clampPanelListWidth: (next: number, maxWidth: number) => number, setPanelListWidth: (next: number) => void, usePanelListWidth: () => number | null;
