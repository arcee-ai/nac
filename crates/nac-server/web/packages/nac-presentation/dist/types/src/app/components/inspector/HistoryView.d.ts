/**
 * Every revision the session has captured, newest first, with the live working
 * tree at the top. A wide screen switches these from the session header; a
 * phone has no header chip, so they get a panel of their own.
 */
export declare function HistoryView({ sessionId, selected, onSelect, }: {
    sessionId: string;
    selected: number | null;
    onSelect: (revision: number | null) => void;
}): import("react").JSX.Element;
