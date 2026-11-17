import type { ToolPresentation } from "../../lib/toolPresentation";
/**
 * What one tool call did, as a fold row opens it: the call's product label and
 * status in words, the bounded argument it acted on, and the bounded preview of
 * what came back. Never the raw tool body.
 */
export declare const ToolCallDetail: import("react").MemoExoticComponent<({ tool }: {
    tool: ToolPresentation;
}) => import("react").JSX.Element>;
