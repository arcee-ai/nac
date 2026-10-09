import { Cause, Effect } from "effect";
declare const CommandFailure_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "CommandFailure";
} & Readonly<A>;
/** Expected command failures retain the transport's error for product recovery UI. */
export declare class CommandFailure extends CommandFailure_base<{
    operation: "submit" | "stop" | "create" | "steer" | "queue";
    cause: unknown;
}> {
}
/** Admission comes from the typed client; this workflow never invents or retries it. */
export type PromptAdmission<T> = {
    kind: "accepted";
    value: T;
} | {
    kind: "not-sent";
    error: unknown;
} | {
    kind: "uncertain";
    error: unknown;
};
/** Origin-bound capabilities keep settlement alive after presentation detaches. */
export interface SubmitPorts<T> {
    optimistic: () => void;
    admit: () => Promise<PromptAdmission<T>>;
    rejected: () => void;
    reconcile: (replace: boolean) => void;
}
/** Admit exactly once, retaining uncertain optimistic input until canonical reconciliation. */
export declare function submitPrompt<T>(ports: SubmitPorts<T>): Effect.Effect<T, CommandFailure>;
/** Stop rollback and settlement belong to the request's origin, never the current view. */
export declare function stopRun(ports: {
    optimistic: () => void;
    cancel: () => Promise<unknown>;
    rollback: () => void;
    settled: () => void;
}): Effect.Effect<void, CommandFailure>;
/** Create once and accept its canonical snapshot before navigation can mount the chat. */
export declare function createChat<T>(ports: {
    create: () => Promise<T>;
    accept: (created: T) => void;
}): Effect.Effect<T, CommandFailure>;
/** Direct input is durable inbox steering/queueing; classic running input remains steering. */
export declare function deliverPrompt(ports: {
    mode: "idle" | "direct-running" | "classic-running";
    delivery?: "steer" | "queue";
    submit: () => Promise<unknown>;
    inbox: (delivery: "steer" | "queue") => Promise<unknown>;
    steer: () => Promise<unknown>;
}): Effect.Effect<"submitted" | "steered" | "queued", CommandFailure>;
/** Unwrap only expected workflow failures; defects retain Effect's diagnostics. */
export declare function runCommand<T>(command: Effect.Effect<T, CommandFailure>): Promise<T>;
export {};
