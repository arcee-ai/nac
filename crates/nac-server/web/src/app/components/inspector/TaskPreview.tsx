import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";

/**
 * Grace period between leaving the hint and closing its preview, so the pointer
 * can cross the gap into the card — which the reader has to do to scroll a task
 * longer than the card is tall.
 */
const HOVER_CLOSE_DELAY_MS = 160;

/** The task affordance itself: an info glyph and an underlined label. */
function TaskLabel({
  text,
  active,
  large = false,
}: {
  text: string;
  active: boolean;
  large?: boolean;
}) {
  return (
    <>
      <Icon
        iconName={IconName.Info}
        size={large ? 20 : 16}
        className={cn(
          "shrink-0",
          active ? "text-basic-primary" : "text-btn-secondary",
        )}
      />
      <span
        className={cn(
          "underline",
          large ? "label-small" : "label-micro",
          active ? "text-basic-primary" : "text-btn-secondary",
        )}
      >
        {text}
      </span>
    </>
  );
}

/**
 * The panel every deliberate task affordance opens: the dispatch as prose, wide
 * enough to read and scrolled rather than allowed to grow, since a task can run
 * to several paragraphs that nothing it hangs off has room for.
 */
function TaskPopover({
  action,
  open,
  onClose,
  children,
}: {
  action: string;
  open: boolean;
  onClose: () => void;
  /** The trigger the panel hangs off. */
  children: ReactNode;
}) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      placement={PopoverPlacement.BottomRight}
      sticky
      size="w-[430px] max-w-[calc(100vw-16px)]"
      panelClassName="p-4 max-h-[260px] overflow-auto"
      sheetClassName="max-h-[70vh] overflow-auto"
      className="shrink-0"
      content={
        <Markdown className="text-basic-primary px-4 md:px-0">
          {action}
        </Markdown>
      }
    >
      {children}
    </Popover>
  );
}

/**
 * What the thread was asked to do, on demand from the panel header.
 *
 * The dispatch carries this from the moment the thread starts, so it is the one
 * thing about a running thread that can be read before it has produced
 * anything.
 */
export function TaskButton({
  action,
  large = false,
}: {
  action: string;
  /** The phone header, where the touch target and its label are a size up. */
  large?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <TaskPopover action={action} open={open} onClose={() => setOpen(false)}>
      <button
        type="button"
        className="flex items-center gap-1 shrink-0"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {/* Unlike the hover hint, nothing here happens on its own, so the
            label has to say what the click will do. */}
        <TaskLabel text="See task" active={open} large={large} />
      </button>
    </TaskPopover>
  );
}

/**
 * The same panel from a pill, for the phone's floating view switch — where an
 * underlined label beside two solid pills would read as a stray link rather
 * than as the third control of the set.
 */
export function TaskPill({ action }: { action: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TaskPopover action={action} open={open} onClose={() => setOpen(false)}>
      <Button
        size={ButtonSize.Medium}
        variant={open ? ButtonVariant.Primary : ButtonVariant.Secondary}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Task
      </Button>
    </TaskPopover>
  );
}

/**
 * The same task as a hover preview, for the thread cards in the chat.
 *
 * The card is too small to carry the task and stops being about it the moment
 * the thread answers, so the hint only appears under the pointer. Its preview
 * outlives the pointer leaving the hint: the reader has to travel over a gap to
 * reach the card, and scrolling it means being nowhere near the hint at all.
 */
export function TaskPreviewHoverHint({
  action,
  onOpenChange,
}: {
  action: string;
  /** Keeps the hint mounted by its owner while the preview is up. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback(() => {
    cancelClose();
    setOpen(true);
    onOpenChange?.(true);
  }, [cancelClose, onOpenChange]);

  const scheduleHide = useCallback(() => {
    cancelClose();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setOpen(false);
      onOpenChange?.(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose, onOpenChange]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <Popover
      open={open}
      onClose={() => {
        cancelClose();
        setOpen(false);
        onOpenChange?.(false);
      }}
      placement={PopoverPlacement.TopLeft}
      sticky
      // A pointer-only affordance, so the phone's sheet would have no way of
      // ever being opened.
      sheetOnMobile={false}
      closeOnOutsideClick={false}
      size="w-[320px]"
      panelClassName="p-2 max-h-[160px] overflow-auto"
      className="shrink-0"
      content={
        <div onMouseEnter={show} onMouseLeave={scheduleHide}>
          <Markdown className="task-preview text-basic-primary">
            {action}
          </Markdown>
        </div>
      }
    >
      <span
        className="flex items-center gap-1 shrink-0"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      >
        <TaskLabel text="Task" active={open} />
      </span>
    </Popover>
  );
}
