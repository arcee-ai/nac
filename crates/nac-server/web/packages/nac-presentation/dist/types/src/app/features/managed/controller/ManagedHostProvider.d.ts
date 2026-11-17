/**
 * Managed host product state. Host settings (status, GitHub device auth,
 * secrets) live at Settings › Managed host; "Add repository" stays a dialog and
 * may detour through GitHub authorization before reopening itself.
 */
export declare function ManagedHostProvider({ children }: {
    children: React.ReactNode;
}): import("react").JSX.Element;
