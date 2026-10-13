import type { Terminal } from "@xterm/xterm";
/** Public renderer/browser events supply intent; parsed output never does. */
export declare function observeHumanTerminalInput(terminal: Terminal, send: (bytes: Uint8Array) => void): () => void;
