import { Cause, Effect } from "effect";
import type { ShellCommandRequest, ShellCommandSnapshot } from "../../types/api.js";
import type { ShellIntents } from "./intents.js";
declare const HumanCommandFailure_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "HumanCommandFailure";
} & Readonly<A>;
export declare class HumanCommandFailure extends HumanCommandFailure_base<{
    kind: "blocked" | "rejected" | "not-sent" | "uncertain";
    cause: unknown;
}> {
}
interface CommandPorts {
    readonly sessionId: string;
    readonly command: string;
    readonly intents: ShellIntents;
    readonly submit: (request: Readonly<ShellCommandRequest>) => Promise<ShellCommandSnapshot>;
    readonly lookup: (requestId: string) => Promise<ShellCommandSnapshot>;
    readonly settled: () => void;
}
/**
 * One scoped admission claim, one submit, and origin settlement before view callbacks.
 * Unknown intent survives remount; a changed command first needs canonical readback.
 * Transport remains the only POST + same-ID GET admission owner; no automatic replay.
 */
export declare function submitHumanCommand(ports: CommandPorts): Effect.Effect<ShellCommandSnapshot, HumanCommandFailure>;
/** Keep expected failures usable by the composer; defects retain diagnostics. */
export declare function runHumanCommand(workflow: Effect.Effect<ShellCommandSnapshot, HumanCommandFailure>): Promise<{
    accepted_at_epoch_ms: number;
    command: string;
    diagnostic?: string | null;
    exit_code?: number | null;
    finished_at_epoch_ms?: number | null;
    operation_id: string;
    output_id?: string | null;
    request_id: string;
    state: import("../../types/openapi.generated.js").components["schemas"]["ShellCommandState"];
    stderr: string;
    stdout: string;
    timeout_ms: number;
    transcript_index?: number | null;
}>;
export {};
