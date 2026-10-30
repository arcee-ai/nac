// The durable goal continuation control message, pinned byte-for-byte with
// nac-core `commands/goal_continuation.rs` by
// fixtures/goal-continuation-format.json at the repo root. The transcript keeps
// the message verbatim for the model; people see only its goal and objective.
const OPEN = '<nac_goal_continuation goal_id="';
const HEADER = '">\nContinue autonomously pursuing this durable goal:\n';
const INSTRUCTIONS =
  "\nUse get_goal when you need current accounting. Mark it complete only when the objective is genuinely achieved with no required work remaining. Mark it blocked only at a genuine impasse; otherwise finish this turn with a concise progress update and NAC will continue it.\n</nac_goal_continuation>";
const CLOSE = "\n</nac_goal_continuation>";
const NO_BUDGET = "No token budget was set.";
const BUDGET_LINE = /^Token budget: \d+; used: \d+; remaining: \d+\.$/;

export interface GoalContinuation {
  goalId: string;
  objective: string;
}

/** The goal and objective of a well-formed continuation message, or null. */
export function parseGoalContinuation(content: string | null | undefined): GoalContinuation | null {
  if (typeof content !== "string") return null;
  const text = content.replaceAll("\r\n", "\n");
  if (!text.startsWith(OPEN) || !text.endsWith(INSTRUCTIONS)) return null;
  const header = text.indexOf(HEADER, OPEN.length);
  if (header === -1) return null;
  const goalId = text.slice(OPEN.length, header);
  if (!goalId || goalId.includes('"') || goalId.includes("\n")) return null;
  const bodyStart = header + HEADER.length;
  const bodyEnd = text.length - INSTRUCTIONS.length;
  if (bodyEnd < bodyStart) return null;
  const body = text.slice(bodyStart, bodyEnd);
  const split = body.lastIndexOf("\n");
  if (split === -1) return null;
  const objective = body.slice(0, split);
  const budget = body.slice(split + 1);
  if (!objective.trim() || (budget !== NO_BUDGET && !BUDGET_LINE.test(budget))) return null;
  return { goalId, objective };
}

/**
 * Whether a message is shaped like any continuation envelope, including one
 * whose body does not parse. Such a message is still control text, never a
 * prompt to show or send again.
 */
export function isGoalContinuationEnvelope(content: string | null | undefined): boolean {
  if (typeof content !== "string") return false;
  const text = content.replaceAll("\r\n", "\n");
  return text.startsWith(OPEN) && text.endsWith(CLOSE);
}
