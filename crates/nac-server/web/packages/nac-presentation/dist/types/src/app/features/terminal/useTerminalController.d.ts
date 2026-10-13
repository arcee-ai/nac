import { type RefObject } from "react";
import type { ExecutionStatus, InputControlStatus } from "../../../../packages/nac-client/src/index";
export declare function useTerminalController(sessionId: string, terminalId: string, element: RefObject<HTMLDivElement | null>, source?: ExecutionStatus, options?: {
    readonly?: boolean;
    inputControl?: InputControlStatus | null;
    inputPaused?: boolean;
}): {
    phase: string;
    notice: string;
    inputFailure: boolean;
    reconnect: () => void;
    selection: () => string;
    focus: () => void | undefined;
    hasActiveInput: () => boolean;
    acknowledgeInput: (confirmed?: InputControlStatus) => boolean;
};
