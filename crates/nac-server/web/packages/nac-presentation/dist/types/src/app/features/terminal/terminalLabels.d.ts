import type { ExecutionHistoryEntry, ExecutionStatus, InputControlStatus } from "../../../../packages/nac-client/src/index";
/** What the detail's header names and its hint explains. */
export interface TerminalHeading {
    title: string;
    /** The design's `Agent` tag, as `agentTagged` decides it. */
    agent: boolean;
    /** The hint's title: who runs the execution. */
    about: string;
    /** The hint's description, spoken in full after `about`. */
    facts: string;
}
/** A row's name. The position keeps two terminals of one kind apart. */
export declare function terminalTitle(source: ExecutionStatus, index: number): string;
/** Spoken after a row's name, which draws no state of its own. */
export declare function terminalState(source: ExecutionStatus): string;
/** The design's `Agent` tag: the agent runs the execution, or holds a human shell's input. */
export declare function agentTagged(source: ExecutionStatus, controller?: InputControlStatus["controller"]): boolean;
export declare function executionHeading(source: ExecutionStatus, title: string, controller?: InputControlStatus["controller"]): TerminalHeading;
/** A recent entry's name: a command reads as itself, anything else by when it started. */
export declare function historyTitle(entry: ExecutionHistoryEntry): string;
export declare function historyHeading(entry: ExecutionHistoryEntry): TerminalHeading;
