import type React from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

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
const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
  itemLabel = "items",
  className = "",
}) => {
  const isMobile = useIsMobile();
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const first = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  return (
    <div
      className={cn(
        "flex items-center w-full gap-4 px-4 py-3",
        isMobile ? "justify-center" : "justify-between",
        className,
      )}
    >
      {isMobile ? null : (
        <div className="label-small text-basic-secondary">
          {first}–{last} of {totalItems} {itemLabel}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant={ButtonVariant.Tertiary}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => onPageChange(page - 1)}
        >
          <Icon iconName={IconName.Left} />
        </Button>
        <div className="label-small text-basic-secondary">
          Page {page} of {totalPages}
        </div>
        <Button
          variant={ButtonVariant.Tertiary}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          disabled={page >= totalPages}
          aria-label="Next page"
          onClick={() => onPageChange(page + 1)}
        >
          <Icon iconName={IconName.Right} />
        </Button>
      </div>
    </div>
  );
};

export default Pagination;
