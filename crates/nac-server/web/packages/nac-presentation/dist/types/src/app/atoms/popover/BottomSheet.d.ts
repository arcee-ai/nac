import React from "react";
interface BottomSheetProps {
    open: boolean;
    onClose: () => void;
    zIndex?: number;
    className?: string;
    children?: React.ReactNode;
}
/**
 * The mobile face of a popover: a sheet that slides up from the bottom edge
 * instead of a panel floating next to a trigger that is barely on screen.
 */
declare const BottomSheet: React.FC<BottomSheetProps>;
export default BottomSheet;
