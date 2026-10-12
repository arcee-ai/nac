export declare const THREAD_LOG_MIN_RATIO = 0.2;
export declare const THREAD_LOG_MAX_RATIO = 0.8;
export declare const THREAD_LOG_DEFAULT_RATIO = 0.4;
export declare function createThreadLogHeight(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    clampThreadLogRatio: (next: number) => number;
    setThreadLogHeightRatio: (next: number) => void;
    useThreadLogHeightRatio: () => number;
};
export declare const release: () => void, clampThreadLogRatio: (next: number) => number, setThreadLogHeightRatio: (next: number) => void, useThreadLogHeightRatio: () => number;
