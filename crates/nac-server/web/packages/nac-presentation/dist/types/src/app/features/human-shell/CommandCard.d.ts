import type { ShellCommandSnapshot } from "../../types/api.js";
export declare function CommandCard({ sessionId, command, readOnly, }: {
    sessionId: string;
    command: ShellCommandSnapshot;
    readOnly?: boolean;
}): import("react").JSX.Element;
