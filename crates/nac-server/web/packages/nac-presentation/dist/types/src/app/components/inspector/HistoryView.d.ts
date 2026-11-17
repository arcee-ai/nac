/**
 * Every revision the session has captured, newest first, with the live working
 * tree at the top. A wide screen also switches these from the session header;
 * the selection here is the same one the Changes panel and that picker read.
 */
export declare function HistoryView({ sessionId, selected, onSelect, }: {
    sessionId: string;
    selected: number | null;
    onSelect: (revision: number | null) => void;
}): import("react").JSX.Element;
