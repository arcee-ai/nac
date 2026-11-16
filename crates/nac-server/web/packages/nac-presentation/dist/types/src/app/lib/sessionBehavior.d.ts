import { IconName } from "../atoms/icon";
import type { SessionPanel } from "./routes";
import type { SessionBehavior, SessionLineage } from "../types/api";
export interface SessionBehaviorPresentation {
    id: SessionBehavior;
    label: string;
    navigationLabel: string;
    topLevel: string;
    editsDirectly: boolean;
    editing: string;
    delegation: string;
    inspection: string;
}
export declare const SESSION_BEHAVIORS: readonly SessionBehaviorPresentation[];
export declare function sessionBehaviorPresentation(behavior: SessionBehavior | null | undefined): SessionBehaviorPresentation;
export declare function sessionBehaviorLabel(behavior: SessionBehavior): string;
/**
 * The session-type glyph, matching the new-session choices. A delegated
 * session's durable relationship decides over its behavior, because the
 * Subagents rows know only which topology they launched.
 */
export declare function sessionBehaviorIcon(behavior: SessionBehavior | null | undefined, lineage?: SessionLineage["kind"] | null): IconName;
/** What `sessionBehaviorIcon` draws, for the accessible name beside the glyph. */
export declare function sessionBehaviorName(behavior: SessionBehavior | null | undefined, lineage?: SessionLineage["kind"] | null): string;
export interface SessionPanelPolicy {
    widePanels: readonly SessionPanel[];
    mobilePanels: readonly SessionPanel[];
    defaultPanel: SessionPanel;
    readOnly: boolean;
}
/**
 * Session ownership and panel topology are related but distinct. Every
 * delegated transcript is read-only, while the durable relationship kind says
 * whether that transcript owns an orchestrator's Worksets or is a traditional
 * child with Insights, Files and History only.
 */
export declare function sessionPanelPolicy(behavior: SessionBehavior | null | undefined, lineageKind: SessionLineage["kind"] | null | undefined): SessionPanelPolicy;
