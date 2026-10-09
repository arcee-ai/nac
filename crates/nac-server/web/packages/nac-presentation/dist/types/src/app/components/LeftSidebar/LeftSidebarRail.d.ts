import type { SidebarCommands } from "./useSidebarCommands.tsx";
/** Icon column left behind once the panel has slid away. */
export declare function LeftSidebarRail({ commands, onToggle, toggleKeys, variant, }: {
    commands: SidebarCommands;
    onToggle: () => void;
    toggleKeys: string[];
    /** All Projects drops the projects shortcut and the new-session menu. */
    variant: "session" | "projects";
}): import("react").JSX.Element;
