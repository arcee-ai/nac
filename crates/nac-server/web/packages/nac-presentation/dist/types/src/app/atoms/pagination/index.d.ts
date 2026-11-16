import type React from "react";
interface PaginationProps {
    /** One-based. */
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
    /** Plural noun for the range summary, e.g. "sessions". */
    itemLabel?: string;
    className?: string;
}
/** Previous / next pager with a range summary, hidden on narrow screens. */
declare const Pagination: React.FC<PaginationProps>;
export default Pagination;
