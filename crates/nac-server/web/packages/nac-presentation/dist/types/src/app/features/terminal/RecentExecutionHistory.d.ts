import { TerminalTabButtonSize } from "../../atoms";
import type { ExecutionHistoryEntry, ExecutionHistoryResponse } from "../../../../packages/nac-client/src/types";
/**
 * The list's Recent section: bounded history, one row per entry, each opening
 * read-only. Opening observes retained output and sends nothing to a process.
 */
export declare function RecentExecutions({ history, pending, failed, openId, size, onOpen, onRefresh, }: {
    history: ExecutionHistoryResponse["history"] | undefined;
    pending: boolean;
    failed: boolean;
    openId: string | null;
    size: TerminalTabButtonSize;
    onOpen: (entry: ExecutionHistoryEntry) => void;
    onRefresh: () => void;
}): import("react").JSX.Element;
/**
 * An opened entry. Retained output replays through the same observer as a live
 * terminal, read-only; anything else shows what history recorded about it.
 */
export declare function HistoryDetail({ sessionId, entry, menuSlot, }: {
    sessionId: string;
    entry: ExecutionHistoryEntry;
    menuSlot: HTMLElement | null;
}): import("react").JSX.Element;
