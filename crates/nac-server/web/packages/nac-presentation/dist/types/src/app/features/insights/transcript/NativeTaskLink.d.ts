import type { ToolPresentation } from "../../../lib/toolPresentation";
type Task = NonNullable<ToolPresentation["launchedTask"]>;
type Candidate = {
    key: string;
    groupId: string;
    task: Task;
};
/** Receipt-only navigation: an authenticated passive inventory must confirm the identity. */
export declare function NativeTaskLink({ task }: {
    task: Task;
}): import("react").JSX.Element;
/** Validate every receipt before allowing it to suppress another in the same group. */
export declare function NativeTaskLinks({ candidates }: {
    candidates: Candidate[];
}): import("react").JSX.Element[];
export {};
