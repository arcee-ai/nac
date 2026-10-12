import type { SidebarCommands } from "./useSidebarCommands.tsx";
/** Expanded navigation: projects, sessions, and the header's old destinations. */
export declare function LeftSidebarPanel({ isOpen, onToggle, toggleKeys, commands, variant, }: {
    isOpen: boolean;
    onToggle: () => void;
    toggleKeys: string[];
    commands: SidebarCommands;
    /** All Projects searches and filters the card grid instead of listing sessions. */
    variant: "session" | "projects";
}): import("react").JSX.Element;
