import type { TerminalSelectionEvidence } from "../../types/api";
interface Props {
    evidence: TerminalSelectionEvidence;
    canonicalText: string;
    sessionId?: string;
}
/** Passive presentation of server-verified literal evidence; no source reads or actions. */
export declare function TerminalSelectionAttachment({ evidence, canonicalText, sessionId }: Props): import("react").JSX.Element;
export {};
