import type { ReactNode } from "react";
import type { SessionFacts } from "./useSessionFacts";
import type { SessionDrawerControls } from "./useSessionDrawer";
/** "+12 −3", each half only when it has something to count. */
export declare function ChangeCounts({ additions, deletions }: {
    additions: number;
    deletions: number;
}): import("react").JSX.Element;
/**
 * One header chip: a 28px ghost pill with a quiet label, a wash on hover and
 * a firmer one while its drawer is open. The accessible name keeps the panel's
 * name ("Files", "Subagents"…) alongside what the chip shows.
 */
export declare function HeaderPill({ label, tooltip, pressed, onClick, children, className, }: {
    label: string;
    tooltip: string;
    pressed: boolean;
    onClick: () => void;
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
/**
 * The contextual pills, in their fixed order: changes, agents, goal,
 * terminal, schedules. Each renders only when it has something to say, so a
 * quiet session's header is its title alone.
 */
export declare function HeaderPills({ facts, drawer, }: {
    facts: SessionFacts;
    drawer: SessionDrawerControls;
}): import("react").JSX.Element | null;
