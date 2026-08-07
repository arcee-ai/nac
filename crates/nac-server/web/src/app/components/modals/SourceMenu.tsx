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
import { cn } from "@/app/lib/cn";

export type Source =
  | { kind: "catalog" }
  | { kind: "new" }
  | { kind: "file" }
  | { kind: "saved"; configId: string };

/** Create a setup, read one from a file, or reuse one saved earlier. */
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
  const [open, setOpen] = useState(false);

  const pick = (next: Source) => {
    onSelect(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.BottomLeft}
      size="min-w-[260px]"
      className="shrink-0"
      panelClassName="max-h-72 overflow-auto"
      content={
        <>
          <TabButton
            size={TabButtonSize.Medium}
            variant={
              source === "catalog"
                ? TabButtonVariant.Accent
                : TabButtonVariant.Regular
            }
            active={source === "catalog"}
            onClick={() => pick({ kind: "catalog" })}
          >
            <Icon iconName={IconName.Search} />
            <span className="text-left flex-grow">Browse Models</span>
          </TabButton>
          <TabButton
            size={TabButtonSize.Medium}
            variant={
              source === "new"
                ? TabButtonVariant.Accent
                : TabButtonVariant.Regular
            }
            active={source === "new"}
            onClick={() => pick({ kind: "new" })}
          >
            <Icon iconName={IconName.Add} />
            <span className="text-left flex-grow">Create New</span>
          </TabButton>
          <TabButton
            size={TabButtonSize.Medium}
            variant={
              source === "file"
                ? TabButtonVariant.Accent
                : TabButtonVariant.Regular
            }
            active={source === "file"}
            onClick={() => pick({ kind: "file" })}
          >
            <Icon iconName={IconName.File} />
            <span className="text-left flex-grow">From a .toml file</span>
          </TabButton>
          {configurations.length > 0 ? (
            <div className="h-px w-full bg-divider-muted my-1" />
          ) : null}
          {configurations.map((entry) => (
            <div key={entry.id} className="flex items-center gap-1">
              <TabButton
                size={TabButtonSize.Medium}
                variant={
                  activeId === entry.id
                    ? TabButtonVariant.Accent
                    : TabButtonVariant.Regular
                }
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
                size={ButtonSize.Medium}
                content={ButtonContent.Icon}
                aria-label={`Remove ${entry.name}`}
                onClick={() => onDelete(entry.id, entry.name)}
              >
                <Icon iconName={IconName.Trash} />
              </Button>
            </div>
          ))}
        </>
      }
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
