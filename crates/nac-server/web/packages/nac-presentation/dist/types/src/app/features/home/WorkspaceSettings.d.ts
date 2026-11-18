/**
 * The composer strip's "⋯" button: whether the session gets an isolated
 * checkout, and the ref it starts from. Folded away so a plain session never
 * meets checkout choices. The checkout needs a direct agent on a Local Git
 * project, so the switch is live only when `available`.
 */
export declare function WorkspaceSettings({ isolated, available, onIsolatedChange, gitRef, defaultRef, onRefChange, disabled, }: {
    isolated: boolean;
    available: boolean;
    onIsolatedChange: (isolated: boolean) => void;
    gitRef: string;
    defaultRef: string | null;
    onRefChange: (ref: string) => void;
    disabled?: boolean;
}): import("react").JSX.Element;
