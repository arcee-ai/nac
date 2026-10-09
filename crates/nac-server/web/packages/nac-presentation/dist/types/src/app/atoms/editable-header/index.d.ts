import React from "react";
export declare enum EditableHeaderSize {
    Micro = "header-micro",
    Small = "header-small",
    Medium = "header-medium"
}
interface EditableHeaderProps {
    value: string;
    onCommit: (value: string) => void;
    size?: EditableHeaderSize;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}
/**
 * Heading that turns into a field on click. Enter and blur commit, Escape puts
 * the previous text back; nothing is reported unless the text actually changed.
 */
declare const EditableHeader: React.FC<EditableHeaderProps> & {
    Size: typeof EditableHeaderSize;
};
export default EditableHeader;
