import type { ReactNode } from "react";
/**
 * The page frame a list-and-form manager (Configurations, MCP servers, SSH
 * hosts) renders into on the Settings page instead of a dialog: one hairline
 * card with the list beside the form and the form's explicit Save row below.
 *
 * `data-settings-surface` is the focus boundary the forms use to place late
 * validation feedback, the way they use `data-modal-open` inside a dialog.
 */
export declare function SettingsSurface({ label, footer, children, className, }: {
    label: string;
    footer?: ReactNode;
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
