import type { Terminal } from "@xterm/xterm";
import type { TerminalLinkMode } from "./terminalLinkMode";
import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index";
/** Only public xterm APIs. Bytes are acknowledged after its parser callback. */
export declare function createTerminalRenderer(element: HTMLElement, options?: {
    readonly linkMode?: TerminalLinkMode;
}): Promise<{
    terminal: Terminal;
    renderer: UserTerminalRenderer;
    fit: () => {
        cols: number;
        rows: number;
    } | null;
    dispose: () => void;
}>;
