import React, { useRef, useEffect, useState } from "react";

interface DropdownContentProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  children: React.ReactNode;
  onCloseMaxHeight?: number; // Optional max-height to use when closing instead of 0
  isScrollable?: boolean; // Optional flag to enable vertical scrolling
  scrollToBottom?: boolean; // Optional flag to auto-scroll to bottom on content height change (throttled)
}

const DropdownContent: React.FC<DropdownContentProps> = ({
  isOpen,
  children,
  className = "",
  onCloseMaxHeight,
  isScrollable = false,
  scrollToBottom = false,
  ...props
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);
  const scrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (contentRef.current) {
      if (isOpen) {
        // Set height to content height when opening
        const contentHeight = contentRef.current.scrollHeight;
        setHeight(contentHeight);
      } else {
        // Set height to onCloseMaxHeight (if provided) or 0 when closing
        setHeight(onCloseMaxHeight ?? 0);
      }
    }
  }, [isOpen, onCloseMaxHeight]);

  // Use ResizeObserver to update height when content size changes while open
  useEffect(() => {
    if (!isOpen || !contentRef.current) return;

    const handleResize = () => {
      if (contentRef.current) {
        setHeight(contentRef.current.scrollHeight);
      }
    };

    // Create ResizeObserver instance
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(contentRef.current);

    // Set initial height
    handleResize();

    // Cleanup
    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  // Auto-scroll to bottom on content height change (independent of isOpen)
  useEffect(() => {
    if (!isScrollable || !scrollToBottom || !containerRef.current || !contentRef.current) {
      return;
    }

    const handleResize = () => {
      if (!containerRef.current) return;

      // Throttle: if timeout already exists, don't reset it - let it execute
      // This prevents infinite reset loop when ResizeObserver fires frequently
      // Note: This is throttling (execute at most once per time period), not debouncing (delay until activity stops)
      if (scrollTimeoutRef.current !== null) {
        return;
      }

      // Throttle scroll to bottom (100ms delay)
      scrollTimeoutRef.current = window.setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
        scrollTimeoutRef.current = null;
      }, 100);
    };

    // Create ResizeObserver instance for scroll behavior
    // Observe contentRef to detect when content changes
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(contentRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [isScrollable, scrollToBottom]);

  const overflowClass = isScrollable ? "overflow-y-auto" : "overflow-hidden";

  return (
    <div
      {...props}
      ref={containerRef}
      className={`${overflowClass} transition-[height] duration-150 ease-out ${className}`}
      style={{
        height: `${height}px`,
        ...props.style,
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
};

export default DropdownContent;
