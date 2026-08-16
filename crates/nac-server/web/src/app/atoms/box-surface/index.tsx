import type React from "react";
import { cn } from "../../lib/cn";

interface BoxSurfaceProps {
  title?: React.ReactNode;
  headerContent?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

/**
 * Elevated panel with an optional header (title + trailing slot), a scrollable
 * body and an optional footer. Mirrors the Figma "BoxSurface" component.
 */
const BoxSurface: React.FC<BoxSurfaceProps> = ({
  title,
  headerContent,
  footer,
  className = "",
  bodyClassName = "",
  children,
}) => {
  const showHeader = title != null || headerContent != null;
  return (
    <div
      className={cn(
        "flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex",
        className,
      )}
    >
      {showHeader ? (
        <div className="flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0">
          <div className="header-md text-basic-primary flex-1 min-w-0 truncate">{title}</div>
          {headerContent}
        </div>
      ) : null}
      {/* A flex column shrinks its children instead of scrolling them, and an
          overflow-hidden child gets an automatic minimum size of 0, so rows
          collapse once the content overflows without `shrink-0`. */}
      <div className={cn("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", bodyClassName)}>
        {children}
      </div>
      {footer ? (
        <div className="flex items-center p-4 border-t border-muted shrink-0">{footer}</div>
      ) : null}
    </div>
  );
};

export default BoxSurface;
