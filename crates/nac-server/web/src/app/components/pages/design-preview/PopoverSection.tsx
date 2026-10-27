import { useState } from "react";
import {
  BoxSurface,
  Button,
  ButtonVariant,
  CopyButton,
  KeyboardShortcut,
  Popover,
  PopoverPlacement,
} from "@/app/atoms";

export function PopoverSection() {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <BoxSurface title="Popover, copy, shortcuts">
      <div className="p-4 flex flex-wrap items-center gap-4">
        <Popover
          open={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          placement={PopoverPlacement.BottomRight}
          // The surrounding box clips its overflow, so the panel is portalled.
          sticky
          content={
            <>
              <div className="label-small text-basic-primary px-2 py-1">Anchored panel</div>
              <div className="text-micro text-basic-muted px-2 pb-1">
                Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead.
              </div>
            </>
          }
        >
          <Button
            variant={ButtonVariant.Secondary}
            onClick={() => setPopoverOpen((current) => !current)}
          >
            Open popover
          </Button>
        </Popover>
        <CopyButton value="nac" />
        <KeyboardShortcut keys={["cmd", "shift", "k"]} />
      </div>
    </BoxSurface>
  );
}
