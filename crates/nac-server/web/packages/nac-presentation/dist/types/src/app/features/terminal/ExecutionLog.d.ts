import { type ReactNode } from "react";
import { type ExecutionStatus } from "../../../../packages/nac-client/src/index";
import type { TerminalHeading } from "./terminalLabels";
export declare function ExecutionLog({ sessionId, source, heading, menuSlot, notices, }: {
    sessionId: string;
    source: ExecutionStatus;
    heading: TerminalHeading;
    menuSlot: HTMLElement | null;
    notices?: readonly ReactNode[];
}): import("react").JSX.Element;
