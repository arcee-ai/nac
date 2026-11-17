import { BadgeColor } from "@/app/atoms";
import type { GoalStatus } from "@/app/types/api";

export function goalStatusLabel(status: GoalStatus): string {
  const label = status.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function goalBadgeColor(status: GoalStatus): BadgeColor {
  if (status === "active") return BadgeColor.Green;
  if (status === "complete") return BadgeColor.Gray;
  return BadgeColor.Yellow;
}
