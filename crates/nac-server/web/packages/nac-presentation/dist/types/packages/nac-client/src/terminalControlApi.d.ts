import { type NacClient } from "./nacClient.js";
import type { ControlledTerminalInputRequest, TransferTerminalControlRequest } from "./types.js";
import type { UserTerminalApi } from "./userTerminalApi.js";
export declare function createTerminalControlApi(client: NacClient): {
    getTerminalInputControl: (session: string, id: string, signal?: AbortSignal) => Promise<{
        controller: import("./openapi.generated.js").components["schemas"]["InputController"];
        frozen: boolean;
        in_flight: boolean;
        revision: string;
    }>;
    transferTerminalInputControl: (session: string, id: string, body: TransferTerminalControlRequest, signal?: AbortSignal) => Promise<{
        controller: import("./openapi.generated.js").components["schemas"]["InputController"];
        frozen: boolean;
        in_flight: boolean;
        revision: string;
    }>;
    inputControlledTerminal: (session: string, id: string, body: ControlledTerminalInputRequest, signal?: AbortSignal) => Promise<{
        error?: string | null;
        outcome: import("./openapi.generated.js").components["schemas"]["InputDeliveryOutcome"];
    }>;
};
export type TerminalControlApi = ReturnType<typeof createTerminalControlApi>;
/** Bind one pump activation to one immutable revision. Discard the activation
 * when control changes; pending bytes cannot migrate to a later controller. */
export declare function controlledTerminalInput(api: Pick<TerminalControlApi, "inputControlledTerminal">, revision: string): UserTerminalApi["inputUserTerminal"];
