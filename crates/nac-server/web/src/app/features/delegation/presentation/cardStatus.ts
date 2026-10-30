import { SubagentCardStatus } from "@/app/atoms";
import type { TraditionalChildStatus } from "@/app/types/api";

export interface CardStatus {
  status: SubagentCardStatus;
  /** The outcome the card names; only a session that did not finish has one. */
  label?: string;
}

const CARD_STATUS: Record<TraditionalChildStatus, CardStatus> = {
  idle: { status: SubagentCardStatus.Ready },
  running: { status: SubagentCardStatus.Running },
  completed: { status: SubagentCardStatus.Ready },
  failed: { status: SubagentCardStatus.Failed, label: "Failed" },
  cancelled: { status: SubagentCardStatus.Failed, label: "Cancelled" },
  interrupted: { status: SubagentCardStatus.Failed, label: "Interrupted" },
};

/** A delegated session's status as its transcript card shows it. */
export function cardStatus(status: TraditionalChildStatus): CardStatus {
  return CARD_STATUS[status];
}
