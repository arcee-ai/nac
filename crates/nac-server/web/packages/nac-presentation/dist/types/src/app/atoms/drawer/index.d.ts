import React from "react";
export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    /** Accessible name and visible heading. */
    title: React.ReactNode;
    /** Plain-text name when `title` is not a string. */
    label?: string;
    /** Controls trailing the title (filters, scope toggles). */
    headerActions?: React.ReactNode;
    /** Desktop only: the drawer fills the window instead of its 560px column. */
    expanded?: boolean;
    onToggleExpanded?: () => void;
    /** Desktop only: dock the drawer as a side column (⌘\). */
    onPin?: () => void;
    /** Hide the built-in header for content that heads itself. */
    bare?: boolean;
    className?: string;
    bodyClassName?: string;
    children?: React.ReactNode;
}
/**
 * Focus's one secondary surface: a sheet from the right on desktop and from
 * the bottom on phones. It floats over the conversation with a whisper of a
 * scrim, keeps global shortcuts live (layer "sheet"), and returns focus where
 * it came from through the shared layer stack.
 */
export default function Drawer({ open, onClose, title, label, headerActions, expanded, onToggleExpanded, onPin, bare, className, bodyClassName, children, }: DrawerProps): React.JSX.Element | null;
