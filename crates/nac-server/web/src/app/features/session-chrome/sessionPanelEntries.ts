import { goalStatusLabel } from "@/app/features/session-chrome/goalStatus";
import type { SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import type { SessionPanel } from "@/app/lib/routes";

/** What a Session menu row opens: one of the drawer's panels, or the goal. */
export type SessionPanelTarget = SessionPanel | "goal";

/** The Session menu's panel rows on a phone, in one fixed order. */
const ORDER: readonly SessionPanelTarget[] = [
  "files",
  "delegated",
  "worksets",
  "terminal",
  "goal",
  "heartbeats",
  "insights",
  "history",
];

/**
 * The panels the Session menu lists. A wide screen reaches the drawer's panels
 * from the header's panel toggle and the drawer's own tabs, so it lists only
 * the goal, which has a drawer of its own. A phone has neither, so its sheet
 * lists every panel the behavior allows. The goal is listed only while one
 * exists.
 */
export function sessionPanelEntries(facts: SessionFacts, phone: boolean): SessionPanelTarget[] {
  const allowed = phone ? (facts.policy?.mobilePanels ?? []) : [];
  return ORDER.filter((target) =>
    target === "goal" ? facts.goal != null : allowed.includes(target),
  );
}

/**
 * What is live in the session's background, as short phrases for the Session
 * menu trigger's description: running subagents, an active goal, an armed
 * schedule. Empty when nothing is, and then the trigger draws no dot. The
 * session's own run already has the title's status dot, and changes are a
 * fact rather than activity, so neither counts here.
 */
export function sessionLiveFacts(facts: SessionFacts): string[] {
  const live: string[] = [];
  const agents = facts.agents;
  if (agents && agents.running > 0) {
    const noun = agents.noun === "agent" ? "subagent" : "thread";
    live.push(`${agents.running} ${noun}${agents.running === 1 ? "" : "s"} running`);
  }
  if (facts.goal?.status === "active") live.push(`Goal ${goalStatusLabel("active")}`);
  if (facts.schedulesActive) live.push("Schedules active");
  return live;
}
