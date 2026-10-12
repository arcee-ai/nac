import React from "react";
interface DropdownContentProps extends React.HTMLAttributes<HTMLDivElement> {
    isOpen: boolean;
    children: React.ReactNode;
    onCloseMaxHeight?: number;
    isScrollable?: boolean;
    scrollToBottom?: boolean;
}
declare const DropdownContent: React.FC<DropdownContentProps>;
export default DropdownContent;
