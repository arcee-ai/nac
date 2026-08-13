import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

export type Source =
  | { kind: "catalog" }
  | { kind: "new" }
  | { kind: "file" }
  | { kind: "saved"; configId: string };

export function SourceMenu({
  label,
  configurations,
  activeId,
  source,
  onSelect,
  onDelete,
}: {
  label: string;
  configurations: { id: string; name: string }[];
  activeId: string | null;
  source: Source["kind"];
  onSelect: (source: Source) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const tabSize = isMobile ? TabButtonSize.Large : TabButtonSize.Medium;
  const actionSize = isMobile ? ButtonSize.Large : ButtonSize.Medium;

  const pick = (next: Source) => {
    onSelect(next);
    setOpen(false);
  };

  const menu = (
    <div
      className={cn(
        "flex flex-col min-h-0",
        // Sheet is already full-bleed; desktop popover keeps a fixed width.
        isMobile ? "w-full flex-1 px-2" : "w-[280px] max-h-72",
      )}
    >
      <div className="flex flex-col shrink-0 [&>*]:shrink-0">
        <TabButton
          size={tabSize}
          variant={TabButtonVariant.Regular}
          active={source === "catalog"}
          onClick={() => pick({ kind: "catalog" })}
        >
          <Icon iconName={IconName.Search} />
          <span className="text-left flex-grow">Browse Models</span>
        </TabButton>
        <TabButton
          size={tabSize}
          variant={TabButtonVariant.Regular}
          active={source === "new"}
          onClick={() => pick({ kind: "new" })}
        >
          <Icon iconName={IconName.Add} />
          <span className="text-left flex-grow">Create New</span>
        </TabButton>
        <TabButton
          size={tabSize}
          variant={TabButtonVariant.Regular}
          active={source === "file"}
          onClick={() => pick({ kind: "file" })}
        >
          <Icon iconName={IconName.File} />
          <span className="text-left flex-grow">From a .toml file</span>
        </TabButton>
      </div>
      {configurations.length > 0 ? (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="h-px w-full bg-divider-muted my-1 shrink-0" />
          <div className="flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0">
            {configurations.map((entry) => (
              <div key={entry.id} className="flex items-center gap-1">
                <TabButton
                  size={tabSize}
                  variant={TabButtonVariant.Regular}
                  active={activeId === entry.id}
                  className="flex-1 min-w-0"
                  onClick={() => pick({ kind: "saved", configId: entry.id })}
                >
                  <Icon iconName={IconName.Gear} />
                  <span className="text-left flex-grow truncate">
                    {entry.name}
                  </span>
                </TabButton>
                <Button
                  variant={ButtonVariant.TertiaryDestructive}
                  size={actionSize}
                  content={ButtonContent.Icon}
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => onDelete(entry.id, entry.name)}
                >
                  <Icon iconName={IconName.Trash} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.BottomLeft}
      size="w-auto"
      className="shrink-0"
      panelClassName="max-h-72 overflow-hidden"
      // BottomSheet defaults to overflow-y-auto + [&>*]:shrink-0, which would
      // scroll the whole sheet and collapse the pinned header / list split.
      sheetClassName="overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col"
      content={menu}
    >
      <Button
        variant={ButtonVariant.Secondary}
        size={ButtonSize.Medium}
        content={ButtonContent.IconRight}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="text-left flex-grow truncate max-w-[96px] md:max-w-[220px]">
          {label}
        </span>
        <Icon
          iconName={IconName.Down}
          className={cn(
            "transition-transform duration-150 ease-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </Button>
    </Popover>
  );
}
