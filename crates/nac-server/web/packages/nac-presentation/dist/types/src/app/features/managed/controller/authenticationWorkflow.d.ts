import { Cause, Effect } from "effect";
declare const AuthenticationFailure_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "AuthenticationFailure";
} & Readonly<A>;
/** Provider account commands own settlement; their presentation may detach. */
declare class AuthenticationFailure extends AuthenticationFailure_base<{
    cause: unknown;
}> {
}
export declare function authenticationCommand<T>(ports: {
    command: () => Promise<T>;
    reconcile?: () => Promise<unknown>;
}): Effect.Effect<T, AuthenticationFailure, never>;
export declare function runAuthentication<T>(workflow: Effect.Effect<T, AuthenticationFailure>): Promise<T>;
export {};
