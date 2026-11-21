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
export declare function sessionBehaviorIcon(_behavior: SessionBehavior | null | undefined, _lineage?: SessionLineage["kind"] | null): IconName;
export declare function sessionBehaviorName(_behavior: SessionBehavior | null | undefined, lineage?: SessionLineage["kind"] | null): string;
export interface SessionPanelPolicy {
    widePanels: readonly SessionPanel[];
    mobilePanels: readonly SessionPanel[];
    defaultPanel: SessionPanel;
    readOnly: boolean;
}
/** Child sessions have a read-only transcript; primary sessions expose the direct panels. */
export declare function sessionPanelPolicy(_behavior: SessionBehavior | null | undefined, lineageKind: SessionLineage["kind"] | null | undefined): SessionPanelPolicy;
