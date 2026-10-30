import { memo } from "react";

import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";

/**
 * Always mounted so show/hide can animate opacity + translate like ArceeFM's
 * "Last messages" control — unmounting would skip the exit.
 */
export const JumpToLatest = memo(function JumpToLatest({
  visible,
  onJump,
}: {
  visible: boolean;
  onJump: () => void;
}) {
  return (
    <div
      className={`absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${
        visible
          ? "translate-y-0 scale-100 opacity-100"
          : "translate-y-3 scale-75 opacity-0 pointer-events-none"
      }`}
    >
      <Button
        variant={ButtonVariant.Primary}
        size={ButtonSize.Small}
        content={ButtonContent.IconRight}
        className="!rounded-b-none !shadow-3xl"
        onClick={onJump}
      >
        Last messages
        <Icon iconName={IconName.Down} />
      </Button>
    </div>
  );
});
