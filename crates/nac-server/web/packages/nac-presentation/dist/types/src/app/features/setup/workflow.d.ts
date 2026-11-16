import { Cause, Effect } from "effect";
export type SetupPhase = "read" | "preset" | "project" | "chat" | "configuration" | "title" | "default";
export type FailureKind = "rejected" | "conflict" | "unknown" | "cancelled";
declare const SetupFailure_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "SetupFailure";
} & Readonly<A>;
/** Completed stages are durable facts, not a transaction to roll back or replay. */
export declare class SetupFailure extends SetupFailure_base<{
    phase: SetupPhase;
    kind: FailureKind;
    cause: unknown;
    completed: readonly SetupPhase[];
}> {
}
export declare function requiresSetupReview(error: unknown): error is SetupFailure;
export interface SetupPorts {
    current: () => boolean;
    classify: (cause: unknown, phase: SetupPhase) => FailureKind;
    /** Reconcile the origin even if the initiating presentation has gone away. */
    reconcile: (phase: SetupPhase) => Promise<unknown>;
}
/** One command sequence: no retries, and no new writes after presentation detaches. */
export declare function setupSequence<T>(ports: SetupPorts, body: (step: <A>(phase: SetupPhase, operation: () => Promise<A>, writes?: boolean) => Effect.Effect<A, SetupFailure>) => Effect.Effect<T, SetupFailure>): Effect.Effect<T, SetupFailure>;
export declare function createProjectChat<M, P, C>(ports: SetupPorts & {
    persistsModel?: boolean;
    model: () => Promise<M>;
    project: (model: M) => Promise<P>;
    chat: (model: M, project: P) => Promise<C>;
}): Effect.Effect<{
    model: M;
    project: P;
    chat: C;
}, SetupFailure, never>;
export declare function createConfiguredChat<M, C>(ports: SetupPorts & {
    existing?: () => Promise<C | null>;
    persistsModel?: boolean;
    model: () => Promise<M>;
    chat: (model: M) => Promise<C>;
}): Effect.Effect<C, SetupFailure, never>;
/** Title and config remain separate writes; a partial save remains visible. */
export declare function saveSettings<M>(ports: SetupPorts & {
    check: () => Promise<unknown>;
    persistsModel?: boolean;
    model: () => Promise<M>;
    configurationSaved?: boolean;
    configuration: (model: M) => Promise<unknown>;
    title?: () => Promise<unknown>;
    projectDefault?: (model: M) => Promise<unknown>;
}): Effect.Effect<M, SetupFailure, never>;
export declare function runSetup<T>(workflow: Effect.Effect<T, SetupFailure>): Promise<T>;
export {};
