import type { SidebarCommands } from "./useSidebarCommands.tsx";
/** Expanded navigation: the three primary rows, the project tree, and the settings footer. */
export declare function LeftSidebarPanel({ isOpen, onToggle, onSearch, toggleKeys, searchKeys, commands, variant, }: {
    isOpen: boolean;
    onToggle: () => void;
    onSearch: () => void;
    toggleKeys: string[];
    searchKeys: string[];
    commands: SidebarCommands;
    /** All Projects filters the card grid instead of listing sessions. */
    variant: "session" | "projects";
}): import("react").JSX.Element;
