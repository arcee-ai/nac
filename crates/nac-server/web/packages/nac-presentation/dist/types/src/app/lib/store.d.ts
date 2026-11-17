type Listener = () => void;
type Patch<S> = Partial<S> | ((state: S) => Partial<S> | null | undefined);
export interface Store<S> {
    getState: () => S;
    setState: (patch: Patch<S>) => void;
    subscribe: (listener: Listener) => () => void;
    useStore: <T = S>(selector?: (state: S) => T) => T;
}
export declare function createStore<S extends object>(initial: S,
/** Names the store in the dev perf report; has no effect otherwise. */
name?: string): Store<S>;
/** Resolve browser preferences at call time (also supports standalone test documents). */
export declare const standalonePreferenceStorage: Pick<Storage, "getItem" | "setItem">;
export {};
