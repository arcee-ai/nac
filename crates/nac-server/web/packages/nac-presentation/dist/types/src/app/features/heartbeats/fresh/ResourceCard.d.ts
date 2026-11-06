import type { FreshTaskLaunchReceipt, TaskLaunchRecord } from "../../../types/api";
export declare function ResourceCard({ receipt, launch, present, }: {
    receipt: FreshTaskLaunchReceipt;
    launch?: TaskLaunchRecord;
    present: boolean | undefined;
}): import("react").JSX.Element;
