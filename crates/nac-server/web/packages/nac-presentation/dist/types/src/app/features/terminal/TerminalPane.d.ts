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
}
export declare function TerminalPane(props: TerminalPaneProps): import("react").JSX.Element;
