import { SubagentCardStatus } from "../../../atoms";
import type { TraditionalChildStatus } from "../../../types/api";
export interface CardStatus {
    status: SubagentCardStatus;
    /** The outcome the card names; only a session that did not finish has one. */
    label?: string;
}
/** A delegated session's status as its transcript card shows it. */
export declare function cardStatus(status: TraditionalChildStatus): CardStatus;
