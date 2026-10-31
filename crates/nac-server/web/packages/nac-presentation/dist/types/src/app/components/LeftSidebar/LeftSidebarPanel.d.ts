import type { SidebarCommands } from "./useSidebarCommands.tsx";
/** Expanded navigation: projects, sessions, and the header's old destinations. */
export declare function LeftSidebarPanel({ isOpen, onToggle, onSearch, toggleKeys, commands, variant, }: {
    isOpen: boolean;
    onToggle: () => void;
    onSearch: () => void;
    toggleKeys: string[];
    commands: SidebarCommands;
    /** All Projects filters the card grid instead of listing sessions. */
    variant: "session" | "projects";
}): import("react").JSX.Element;
