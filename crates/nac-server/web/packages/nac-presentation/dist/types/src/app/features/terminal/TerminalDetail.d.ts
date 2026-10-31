import type { ExecutionStatus } from "../../../../packages/nac-client/src/index";
import type { TerminalSelectionCapture } from "./TerminalPane";
import type { TerminalHeading } from "./terminalLabels";
interface ExecutionDetailProps {
    sessionId: string;
    source: ExecutionStatus;
    heading: TerminalHeading;
    menuSlot: HTMLElement | null;
    /** Opened from history: observed read-only, with every control suppressed. */
    historical?: boolean;
    /** What history knows about the output before it is replayed. */
    notice?: string;
    onReviewSelection?: (capture: Readonly<TerminalSelectionCapture>) => void;
}
/** The open execution: an agent's command reads as a log, anything else as a terminal. */
export declare function ExecutionDetail({ sessionId, source, heading, menuSlot, historical, notice, onReviewSelection, }: ExecutionDetailProps): import("react").JSX.Element;
export {};
