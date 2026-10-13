import { UserTerminalInputPump, type UserTerminalApi } from "../../../../packages/nac-client/src/index";
import { createTerminalRenderer } from "./xtermAdapter";
type Adapter = Awaited<ReturnType<typeof createTerminalRenderer>>;
export interface TerminalControls {
    adapter: Adapter;
    pump: UserTerminalInputPump;
}
interface TerminalPorts {
    api: UserTerminalApi;
    sessionId: string;
    terminalId: string;
    host: HTMLDivElement;
    reconnect: boolean;
    previousFailure: {
        current: boolean;
    };
    controls: (value: TerminalControls | null) => void;
    phase: (value: string) => void;
    notice: (value: string) => void;
    inputFailure: (value: boolean) => void;
}
/** One synchronous Scope owns the browser activation; the SDK owns protocol state. */
export declare function openTerminalObservation(ports: TerminalPorts): () => void;
export {};
