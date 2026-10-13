import { type RefObject } from "react";
import type { ExecutionStatus } from "../../../../packages/nac-client/src/index";
export declare function useTerminalController(sessionId: string, terminalId: string, element: RefObject<HTMLDivElement | null>, source?: ExecutionStatus): {
    phase: string;
    notice: string;
    inputFailure: boolean;
    reconnect: () => void;
    selection: () => string;
    focus: () => void | undefined;
    acknowledgeInput: () => void;
};
