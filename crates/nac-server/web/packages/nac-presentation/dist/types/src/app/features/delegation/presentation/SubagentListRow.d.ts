import type { ReactNode } from "react";
import type { TraditionalChildStatus } from "../../../types/api";
/**
 * A quiet row of the Subagents list: the status dot, the session's title,
 * one muted line of state and how long ago it last changed. The opening
 * button is named by the title alone; the state line describes it. Pin and
 * rename sit beside it, revealed on hover where there is hover.
 */
export declare function SubagentListRow({ title, status, stateLine, age, active, isMobile, actions, onClick, }: {
    title: string;
    status: TraditionalChildStatus;
    stateLine: string;
    age: string;
    active: boolean;
    isMobile: boolean;
    actions?: ReactNode;
    onClick: () => void;
}): import("react").JSX.Element;
