import { type ReactNode } from "react";
import type { HeartbeatSpec } from "../../types/api";
export declare function HeartbeatForm({ sessionId, initial, disabled, onSubmit, onCancel, freshTasks, children, }: {
    initial?: HeartbeatSpec;
    disabled: boolean;
    onSubmit: (spec: HeartbeatSpec) => void;
    onCancel: () => void;
    children?: ReactNode;
} & ({
    freshTasks: true;
    sessionId?: undefined;
} | {
    freshTasks?: false;
    sessionId: string;
})): import("react").JSX.Element;
