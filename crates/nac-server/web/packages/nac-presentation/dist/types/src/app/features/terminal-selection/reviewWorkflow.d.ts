import { Effect } from "effect";
declare const SelectionFailure_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "SelectionFailure";
} & Readonly<A>;
/** Expected transport failures are local preview failure or unconfirmed admission. */
export declare class SelectionFailure extends SelectionFailure_base<{
    operation: "preview" | "submit";
    cause: unknown;
}> {
}
/** One operation owns its read/request signal; closing never cancels durable work. */
export declare function openSelectionOperation(activationCurrent: () => boolean): {
    signal: AbortSignal;
    activationCurrent: () => boolean;
    current: () => boolean;
    close: () => void;
};
export type SelectionOperation = ReturnType<typeof openSelectionOperation>;
interface OperationPorts<T> {
    readonly operation: SelectionOperation;
    readonly started: () => void;
    readonly request: (signal: AbortSignal) => Promise<T>;
    readonly confirmed: (value: T) => void;
    readonly failed: (failure: SelectionFailure) => void;
}
/** Preview once and publish only through the operation's presentation fence. */
export declare function previewSelection<T>(ports: OperationPorts<T>): Effect.Effect<void>;
/**
 * Submit once, settle the originating cache before applying a fenced receipt.
 * The request may settle after disposal; abort/detach never authorizes replay.
 * Only the caller's explicit retry can reuse the immutable admission identity.
 */
export declare function submitSelection<T>(ports: OperationPorts<T> & {
    readonly accepted: () => void;
    readonly unconfirmed: () => void;
}): Effect.Effect<void>;
export {};
