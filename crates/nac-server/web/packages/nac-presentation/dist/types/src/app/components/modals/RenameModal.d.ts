import type { SessionSummarySnapshot } from "../../types/api";
interface RenameModalProps {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}
/** Retain accepted presentation authority beyond the form's temporary exit lifetime. */
export declare function RenameModal({ open, onClose, summary }: RenameModalProps): import("react").JSX.Element | null;
export {};
