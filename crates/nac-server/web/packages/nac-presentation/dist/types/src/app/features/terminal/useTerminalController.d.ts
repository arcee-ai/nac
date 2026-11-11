import { type RefObject } from "react";
import type { ExecutionStatus, InputControlStatus } from "../../../../packages/nac-client/src/index";
import type { TerminalLinkMode } from "./terminalLinkMode";
export declare function useTerminalController(sessionId: string, terminalId: string, element: RefObject<HTMLDivElement | null>, source?: ExecutionStatus, options?: {
    readonly?: boolean;
    linkMode?: TerminalLinkMode;
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
