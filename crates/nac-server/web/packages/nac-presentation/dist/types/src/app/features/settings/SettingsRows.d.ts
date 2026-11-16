import { type ReactNode } from "react";
import { IconName } from "../../atoms";
/**
 * A titled group of settings rows: one hairline card whose rows are split by
 * hairlines, the way a system settings pane reads. Rows are 52px on desktop
 * and at least 56px on a phone so every one is a comfortable target.
 */
export declare function SettingsGroup({ title, description, children, className, }: {
    title?: string;
    description?: ReactNode;
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
/** One row: label (and hint) on the left, its control on the right. */
export declare function SettingsRow({ label, hint, control, stacked, icon, className, }: {
    label: ReactNode;
    hint?: ReactNode;
    control?: ReactNode;
    /** Put the control under the label (long values such as a path). */
    stacked?: boolean;
    /** Leading glyph, matching `SettingsLinkRow` rows in the same group. */
    icon?: IconName;
    className?: string;
}): import("react").JSX.Element;
/** A row that navigates: to another settings section or outside the app. */
export declare function SettingsLinkRow({ label, hint, value, to, href, icon, }: {
    label: string;
    hint?: ReactNode;
    value?: ReactNode;
    to?: string;
    href?: string;
    icon?: IconName;
}): import("react").JSX.Element;
/** Lead paragraph under a section's title. */
export declare function SectionLead({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
