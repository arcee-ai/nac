import { type RefObject } from "react";
export declare function useTerminalController(sessionId: string, terminalId: string, element: RefObject<HTMLDivElement | null>, newlyOpened: boolean): {
    phase: string;
    notice: string;
    inputFailure: boolean;
    needsInputEnable: boolean;
    reconnect: () => void;
    selection: () => string;
    focus: () => void | undefined;
    acknowledgeInput: () => void;
};
