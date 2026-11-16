import type { ToolPresentation } from "../../../lib/toolPresentation";
/** Receipt-only navigation: an authenticated passive inventory must confirm the identity. */
export declare function NativeTaskLink({ task }: {
    task: NonNullable<ToolPresentation["launchedTask"]>;
}): import("react").JSX.Element | null;
