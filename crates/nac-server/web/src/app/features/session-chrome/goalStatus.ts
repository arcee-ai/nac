/** How a goal's status reads in the Session menu and the goal drawer. */
const GOAL_STATUS: Record<string, string> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usage_limited: "usage limited",
  budget_limited: "over budget",
  complete: "complete",
};

export function goalStatusLabel(status: string): string {
  return GOAL_STATUS[status] ?? status.replaceAll("_", " ");
}
