import type { SessionFacts } from "./useSessionFacts";
import type { SessionPanel } from "../../lib/routes";
/** What a Session menu row opens: one of the drawer's panels, or the goal. */
export type SessionPanelTarget = SessionPanel | "goal";
/**
 * The panels the Session menu lists, among those the session's behavior
 * allows. A wide screen lists only the panels with something to say (changes,
 * subagents, a goal, schedules), the terminal and Insights; the drawer's own
 * tab strip reaches the rest. A phone's sheet has no tab strip, so it lists
 * every panel the behavior has. The goal is listed only while one exists.
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
