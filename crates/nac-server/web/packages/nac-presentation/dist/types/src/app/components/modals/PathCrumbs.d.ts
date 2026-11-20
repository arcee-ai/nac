/** The listed folder as a clickable trail: each step opens that folder. */
export declare function PathCrumbs({ path, home, onOpen, }: {
    path: string;
    home: string | null;
    onOpen: (path: string) => void;
}): import("react").JSX.Element;
