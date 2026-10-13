import { type ReactNode } from "react";
import type { ExecutionStatus } from "../../../../packages/nac-client/src/index";
export interface TerminalSelectionCapture {
    readonly sessionId: string;
    readonly terminalId: string;
    readonly selectedText: string;
    readonly capturedAtMs: string;
    readonly sourceAlive: boolean;
}
export interface TerminalPaneProps {
    sessionId: string;
    onReviewSelection?: (capture: Readonly<TerminalSelectionCapture>) => void;
    /** Composition slot; historical opening observes the same source read-only. */
    history?: (observe: (source: ExecutionStatus) => void) => ReactNode;
}
export declare function TerminalPane(props: TerminalPaneProps): import("react").JSX.Element;
