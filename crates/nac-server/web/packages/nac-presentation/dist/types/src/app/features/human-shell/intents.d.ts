import type { ShellCommandRequest } from "../../types/api";
export interface ShellIntent {
    readonly request: Readonly<ShellCommandRequest>;
    readonly phase: "dispatching" | "uncertain";
}
/** Private runtime-owned intents, never persisted or retained in a query cache. */
export declare function createShellIntents(): {
    get: (sessionId: string) => ShellIntent | undefined;
    claim(sessionId: string, command: string): ShellIntent;
    confirmed(sessionId: string, intent: ShellIntent): void;
    uncertain(sessionId: string, intent: ShellIntent): void;
    release(): void;
};
export type ShellIntents = ReturnType<typeof createShellIntents>;
