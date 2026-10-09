import type { SessionSummarySnapshot } from "../types/api";
/**
 * Names a chat the way every list in the app names it, with the untitled ones
 * numbered apart.
 *
 * The numbering is read off the whole session list rather than off the caller's
 * slice, so a chat is called the same thing in the tab strip, in the popovers
 * and on its card — a strip showing only half a project's chats would otherwise
 * number them differently from the popover listing all of them.
 */
export declare function useSessionTitle(): (summary: SessionSummarySnapshot | null | undefined) => string;
