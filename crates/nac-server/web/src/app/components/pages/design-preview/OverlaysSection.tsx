import { useEffect, useRef, useState } from "react";
import {
  BottomSheet,
  BoxSurface,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Drawer,
  Icon,
  IconName,
  KeyboardShortcut,
  Popover,
  PopoverPlacement,
  PopoverSize,
  TabButton,
  TabButtonSize,
  Toast,
  ToastVariant,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { Specimen } from "@/app/components/pages/design-preview/Showcase";

const MENU = [
  { icon: IconName.Edit, label: "Rename" },
  { icon: IconName.FileCopy, label: "Copy link" },
  { icon: IconName.Pin, label: "Pin to top" },
];

const SAMPLE_TOASTS: { variant: ToastVariant; content: string }[] = [
  { variant: ToastVariant.Success, content: "Session settings saved" },
  { variant: ToastVariant.Danger, content: "Connection lost. Retrying…" },
  { variant: ToastVariant.Error, content: "Could not update pin" },
];

interface DemoToast {
  id: number;
  variant: ToastVariant;
  content: string;
  dismissing: boolean;
}

/**
 * A local stand-in for the app's toast stack, so the showcase can show the
 * real atom without reaching for the provider (and without announcing
 * anything until asked).
 */
function useDemoToasts() {
  const [toasts, setToasts] = useState<DemoToast[]>([]);
  const next = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  };
  const dismiss = (id: number) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, dismissing: true } : toast)),
    );
    later(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 160);
  };
  const show = () => {
    const sample = SAMPLE_TOASTS[next.current % SAMPLE_TOASTS.length];
    const id = next.current++;
    setToasts((current) => [...current, { id, ...sample, dismissing: false }]);
    later(() => dismiss(id), 3000);
  };
  return { toasts, show, dismiss };
}

/** Popover, tooltip, toast, drawer and bottom sheet: every floating layer. */
export function OverlaysSection() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { toasts, show, dismiss } = useDemoToasts();

  return (
    <BoxSurface title="Overlays">
      <Specimen label="Popover" hint="Overlay surface, 14px corner, 32px rows. A sheet on phones.">
        <Popover
          open={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          placement={PopoverPlacement.BottomRight}
          size={PopoverSize.Small}
          // The surrounding box clips its overflow, so the panel is portalled.
          sticky
          content={MENU.map((item) => (
            <TabButton
              key={item.label}
              size={TabButtonSize.Medium}
              onClick={() => setPopoverOpen(false)}
            >
              <Icon iconName={item.icon} />
              <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
            </TabButton>
          ))}
        >
          <Button
            variant={ButtonVariant.Secondary}
            content={ButtonContent.IconRight}
            aria-expanded={popoverOpen}
            onClick={() => setPopoverOpen((current) => !current)}
          >
            Open popover
            <Icon iconName={IconName.Down} />
          </Button>
        </Popover>
        <CopyButton value="nac" />
        <KeyboardShortcut keys={["cmd", "k"]} />
      </Specimen>
      <Specimen label="Tooltip" hint="An inverse ink chip, 12px, with its shortcut.">
        <Tooltip
          title="New session"
          keyboardShortcuts={["cmd", "n"]}
          position={TooltipPosition.BottomCenter}
        >
          <Button
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="New session"
          >
            <Icon iconName={IconName.Add} />
          </Button>
        </Tooltip>
        <Tooltip
          title="Pin session"
          description="Keeps it at the top of its project."
          position={TooltipPosition.BottomCenter}
          sticky
          showTooltipOnMobile
        >
          <Button variant={ButtonVariant.Ghost} content={ButtonContent.Icon} aria-label="Pin">
            <Icon iconName={IconName.Pin} />
          </Button>
        </Tooltip>
      </Specimen>
      <Specimen label="Toast" hint="A small pill at the bottom centre; errors read in red.">
        <Button variant={ButtonVariant.Secondary} onClick={show}>
          Show a toast
        </Button>
      </Specimen>
      <Specimen label="Drawer and sheet" hint="Right drawer on desktop, bottom sheet on phones.">
        <Button variant={ButtonVariant.Secondary} onClick={() => setDrawerOpen(true)}>
          Open drawer
        </Button>
        <Button variant={ButtonVariant.Secondary} onClick={() => setSheetOpen(true)}>
          Open bottom sheet
        </Button>
      </Specimen>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Changes"
        headerActions={
          <Button variant={ButtonVariant.Ghost} size={ButtonSize.Small}>
            All changes
          </Button>
        }
      >
        <div className="type-body-chrome flex flex-col gap-3 p-4 text-basic-secondary">
          <p>
            Drawers carry everything that is not the conversation: changes, subagents, terminal,
            goal, schedules and insights. They open from the header pills.
          </p>
          <p className="text-basic-tertiary">Escape or the close button returns focus here.</p>
        </div>
      </Drawer>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div className="flex flex-col px-2">
          {MENU.map((item) => (
            <TabButton
              key={item.label}
              size={TabButtonSize.Large}
              onClick={() => setSheetOpen(false)}
            >
              <Icon iconName={item.icon} />
              <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
            </TabButton>
          ))}
        </div>
      </BottomSheet>
      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              variant={toast.variant}
              content={toast.content}
              dismissing={toast.dismissing}
              onClose={() => dismiss(toast.id)}
            />
          ))}
        </div>
      ) : null}
    </BoxSurface>
  );
}
