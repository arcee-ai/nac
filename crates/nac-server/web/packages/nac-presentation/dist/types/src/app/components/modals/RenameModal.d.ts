import type { SessionSummarySnapshot } from "../../types/api";
interface RenameModalProps {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}
/** Presentation authority and in-flight writes outlive the form's exit animation. */
export declare function RenameModal({ open, onClose, summary }: RenameModalProps): import("react").JSX.Element | null;
export {};
