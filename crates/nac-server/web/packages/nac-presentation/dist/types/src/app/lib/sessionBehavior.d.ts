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
/** Leading glyph on a chat row. Matches the new-session choices. */
export declare function sessionBehaviorIcon(behavior: SessionBehavior | null | undefined): IconName;
export interface SessionPanelPolicy {
    widePanels: readonly SessionPanel[];
    mobilePanels: readonly SessionPanel[];
    defaultPanel: SessionPanel;
    readOnly: boolean;
}
/**
 * Session ownership and panel topology are related but distinct. Every
 * delegated transcript is read-only, while the durable relationship kind says
 * whether that transcript owns an orchestrator's Threads and Worksets or is a
 * traditional child with Files/History only.
 */
export declare function sessionPanelPolicy(behavior: SessionBehavior | null | undefined, lineageKind: SessionLineage["kind"] | null | undefined): SessionPanelPolicy;
