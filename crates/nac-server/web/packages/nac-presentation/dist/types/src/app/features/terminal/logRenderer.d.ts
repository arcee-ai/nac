import type { UserTerminalRenderer } from "../../../../packages/nac-client/src/index";
/** Safe bounded text, without VT interpretation, clickable links or HTML. */
export declare function createLogRenderer(host: HTMLElement): {
    renderer: UserTerminalRenderer;
    finish: () => void;
    dispose: () => void;
};
