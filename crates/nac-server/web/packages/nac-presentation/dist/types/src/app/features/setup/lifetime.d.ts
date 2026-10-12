/** Setup reads belong to a view; dispatched commands belong to the origin cache. */
export declare function openSetupLifetime(): {
    signal: AbortSignal;
    current: () => boolean;
    close: () => void;
};
export declare function useSetupLifetime(open?: boolean): import("react").RefObject<{
    signal: AbortSignal;
    current: () => boolean;
    close: () => void;
} | null>;
