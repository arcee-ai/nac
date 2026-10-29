import type { SessionSummarySnapshot } from "../../types/api";
interface RenameModalProps {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}
/** Retain the form through the exit slide; each idle reopen starts from current presentation. */
export declare function RenameModal({ open, onClose, summary }: RenameModalProps): import("react").JSX.Element | null;
export {};
