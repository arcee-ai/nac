export declare const DOCK_MIN_WIDTH = 480;
export declare const DOCK_DEFAULT_WIDTH = 560;
export declare const CHAT_MIN_WIDTH = 460;
export declare function createDockWidth(storage?: Pick<Storage, "getItem" | "setItem">): {
    useDockWidth: () => number;
    setDockWidth: (next: number) => void;
    release: () => void;
};
export declare const useDockWidth: () => number, setDockWidth: (next: number) => void, release: () => void;
