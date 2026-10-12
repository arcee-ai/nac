import type { SessionSummarySnapshot } from "../../types/api";
interface RenameModalProps {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}
/** Mounted only while open, so the fields start from the current presentation. */
export declare function RenameModal({ open, onClose, summary }: RenameModalProps): import("react").JSX.Element | null;
export {};
