import type React from "react";
import type { SessionBehavior, SessionLineage } from "../../types/api";
export declare enum SubagentCardStatus {
    Ready = "ready",
    Running = "running",
    /** Ready's layout with an error mark; `statusLabel` names the outcome. */
    Failed = "failed",
    /** The child session is gone, so the card stays static whatever it is given. */
    NotFound = "not-found"
}
interface SubagentTranscriptCardProps {
    title: string;
    status: SubagentCardStatus;
    /**
     * Outcome shown next to the footer link, such as "Failed" or "Cancelled". A
     * failed card's name ends with it, lowercased.
     */
    statusLabel?: string;
    /** Session type, drawn in the header while the child is ready. */
    behavior?: SessionBehavior | null;
    /** A delegated session's relationship, which decides over its behavior. */
    lineage?: SessionLineage["kind"] | null;
    /** Figma `isNacEnable`: whether the behavior glyph is drawn at all. */
    showBehaviorIcon: boolean;
    /** Opens Subagents with this child selected. Without it the card is no button. */
    onOpen?: () => void;
    /** The child session route behind "Go to session". Without it there is no link. */
    sessionHref?: string | null;
    className?: string;
}
/**
 * A child session in its parent's transcript.
 *
 * The card is a `div`, so no interactive element nests in another: a stretched
 * button opens the child in Subagents and the "Go to session" link sits above
 * it. The button lies under the content, which lets clicks through, so its
 * hover and press backgrounds stay behind the text. The card rings the
 * button's keyboard focus; the link rings its own, so the two Tab stops differ.
 */
declare const SubagentTranscriptCard: React.FC<SubagentTranscriptCardProps>;
export default SubagentTranscriptCard;
