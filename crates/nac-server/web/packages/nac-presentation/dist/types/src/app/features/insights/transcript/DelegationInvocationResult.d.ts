import type { ToolPresentation } from "../../../lib/toolPresentation";
/** The server redacts and bounds this call's own retained output before display. */
export declare function DelegationInvocationResult({ sessionId, blockKey, tool, }: {
    sessionId: string;
    blockKey: string;
    tool: ToolPresentation;
}): import("react").JSX.Element;
