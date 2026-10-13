import { UserTerminalInputPump, type UserTerminalApi, type ExecutionApi, type ExecutionStatus, type InputControlStatus, type TerminalControlApi } from "../../../../packages/nac-client/src/index";
import { createTerminalRenderer } from "./xtermAdapter";
type Adapter = Awaited<ReturnType<typeof createTerminalRenderer>>;
export interface TerminalControls {
    adapter: Adapter;
    pump: UserTerminalInputPump;
    restoreFreshInput: () => boolean;
    hasActiveInput: () => boolean;
    updateInput: (control: TerminalPorts["inputControl"], paused: boolean) => void;
}
interface TerminalPorts {
    api: UserTerminalApi & Partial<ExecutionApi & TerminalControlApi>;
    source?: ExecutionStatus;
    readonly?: boolean;
    inputControl?: Pick<InputControlStatus, "controller" | "revision" | "frozen"> | null;
    inputPaused?: boolean;
    sessionId: string;
    terminalId: string;
    host: HTMLDivElement;
    reconnect: boolean;
    previousFailure: {
        current: boolean;
        readonly available?: boolean;
        subscribe?: (listener: () => void) => () => void;
    };
    controls: (value: TerminalControls | null) => void;
    phase: (value: string) => void;
    notice: (value: string) => void;
    inputFailure: (value: boolean) => void;
}
/** One synchronous Scope owns the browser activation; the SDK owns protocol state. */
export declare function openTerminalObservation(ports: TerminalPorts): () => void;
export {};
