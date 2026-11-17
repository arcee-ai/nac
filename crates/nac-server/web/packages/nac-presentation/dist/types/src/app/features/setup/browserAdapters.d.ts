import type { QueryClient } from "@tanstack/react-query";
import { type FailureKind, type SetupPhase } from "./workflow";
export declare class SetupValidation extends Error {
}
export declare class ConfigurationChanged extends Error {
    constructor();
}
export declare function classifySetupFailure(cause: unknown, phase?: SetupPhase): FailureKind;
export declare function setupFailureMessage(error: unknown): string;
/** Cache settlement is captured from the origin, with no presentation callbacks. */
export declare function setupReconciliation(client: QueryClient, sessionId?: string): (phase: SetupPhase) => Promise<void>;
