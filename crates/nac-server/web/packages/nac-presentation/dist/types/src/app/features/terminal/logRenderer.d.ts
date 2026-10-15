import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index.js";
/** Safe bounded text, without VT interpretation, clickable links or HTML. */
export declare function createLogRenderer(host: HTMLElement, onDisplayTruncation?: (truncated: boolean) => void): {
    renderer: UserTerminalRenderer;
    readonly displayTruncated: boolean;
    finish: () => void;
    dispose: () => void;
};
