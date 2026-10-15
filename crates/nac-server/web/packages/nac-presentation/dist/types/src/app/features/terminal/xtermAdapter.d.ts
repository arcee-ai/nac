import type { Terminal } from "@xterm/xterm";
import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index.js";
/** Only public xterm APIs. Bytes are acknowledged after its parser callback. */
export declare function createTerminalRenderer(element: HTMLElement): Promise<{
    terminal: Terminal;
    renderer: UserTerminalRenderer;
    fit: () => {
        cols: number;
        rows: number;
    } | null;
    dispose: () => void;
}>;
