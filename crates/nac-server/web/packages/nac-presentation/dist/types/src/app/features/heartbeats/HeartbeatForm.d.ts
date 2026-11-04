import { type ReactNode } from "react";
import type { HeartbeatSpec } from "../../types/api";
export declare function HeartbeatForm({ initial, disabled, onSubmit, onCancel, freshTasks, children, }: {
    initial?: HeartbeatSpec;
    disabled: boolean;
    onSubmit: (spec: HeartbeatSpec) => void;
    onCancel: () => void;
    freshTasks?: boolean;
    children?: ReactNode;
}): import("react").JSX.Element;
