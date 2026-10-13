import { UserTerminalInputPump, type UserTerminalApi, type ExecutionApi, type ExecutionStatus } from "../../../../packages/nac-client/src/index";
import { createTerminalRenderer } from "./xtermAdapter";
type Adapter = Awaited<ReturnType<typeof createTerminalRenderer>>;
export interface TerminalControls {
    adapter: Adapter;
    pump: UserTerminalInputPump;
    restoreFreshInput: () => boolean;
}
interface TerminalPorts {
    api: UserTerminalApi & Partial<ExecutionApi>;
    source?: ExecutionStatus;
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
