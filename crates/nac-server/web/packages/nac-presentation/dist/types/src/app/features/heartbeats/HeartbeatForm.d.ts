import type { HeartbeatSpec } from "../../types/api";
export declare function HeartbeatForm({ initial, disabled, onSubmit, onCancel, }: {
    initial?: HeartbeatSpec;
    disabled: boolean;
    onSubmit: (spec: HeartbeatSpec) => void;
    onCancel: () => void;
}): import("react").JSX.Element;
