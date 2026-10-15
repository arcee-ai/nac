import type { SessionSummaryView as SessionSummarySnapshot } from "../../features/public-native/collectionViews.js";
interface DeleteModalProps {
    open: boolean;
    onClose: () => void;
    summary: SessionSummarySnapshot | null;
}
export declare function DeleteModal({ open, onClose, summary }: DeleteModalProps): import("react").JSX.Element;
export {};
