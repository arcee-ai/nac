import type React from "react";
interface TagsSelectorProps {
    tags: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
    disabled?: boolean;
    className?: string;
}
/** Chips that toggle a multi-select, e.g. the environment filter on the board. */
declare const TagsSelector: React.FC<TagsSelectorProps>;
export default TagsSelector;
