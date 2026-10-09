import type { SessionSummarySnapshot } from "../../types/api";
interface DeleteModalProps {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}
export declare function DeleteModal({ open, onClose, summary }: DeleteModalProps): import("react").JSX.Element;
export {};
