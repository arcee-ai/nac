import type { SessionFacts } from "./useSessionFacts";
import type { SessionPanel } from "../../lib/routes";
/** What a Session menu row opens: one of the drawer's panels, or the goal. */
export type SessionPanelTarget = SessionPanel | "goal";
/**
 * The panels the Session menu lists. A wide screen reaches the drawer's panels
 * from the header's panel toggle and the drawer's own tabs, so it lists only
 * the goal, which has a drawer of its own. A phone has neither, so its sheet
 * lists every panel the behavior allows. The goal is listed only while one
 * exists.
 */
export declare function sessionPanelEntries(facts: SessionFacts, phone: boolean): SessionPanelTarget[];
/**
 * What is live in the session's background, as short phrases for the Session
 * menu trigger's description: running subagents, an active goal, an armed
 * schedule. Empty when nothing is, and then the trigger draws no dot. The
 * session's own run already has the title's status dot, and changes are a
 * fact rather than activity, so neither counts here.
 */
export declare function sessionLiveFacts(facts: SessionFacts): string[];
