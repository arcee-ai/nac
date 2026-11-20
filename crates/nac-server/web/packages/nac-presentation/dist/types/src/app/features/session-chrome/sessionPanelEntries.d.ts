import type { SessionFacts } from "./useSessionFacts";
import type { SessionPanel } from "../../lib/routes";
/** What a Session menu row opens: one of the drawer's panels, or the goal. */
export type SessionPanelTarget = SessionPanel | "goal";
/** On desktop, the drawer's tabs open the panels. The menu still opens goals. */
export declare function sessionPanelEntries(facts: SessionFacts, phone: boolean): SessionPanelTarget[];
/**
 * What is live in the session's background, as short phrases for the Session
 * menu trigger's description: running subagents, an active goal, an armed
 * schedule. Empty when nothing is, and then the trigger draws no dot. The
 * session's own run already has the title's status dot, and changes are a
 * fact rather than activity, so neither counts here.
 */
export declare function sessionLiveFacts(facts: SessionFacts): string[];
