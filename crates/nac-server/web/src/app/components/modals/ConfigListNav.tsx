import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Popover,
  PopoverPlacement,
  Separator,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

/**
 * Sidebar that picks a saved setup (or the draft row). On a phone there is no
 * room for the column, so the same rows open from a popover instead of a
 * horizontal strip.
 */
export function ConfigListNav({
  draftLabel,
  draftSelected,
  onSelectDraft,
  entries,
  selectedId,
  onSelect,
  isLoading = false,
}: {
  draftLabel: string;
  draftSelected: boolean;
  onSelectDraft: () => void;
  entries: { id: string; name: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  isLoading?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const selectedLabel = draftSelected
    ? draftLabel
    : (entries.find((entry) => entry.id === selectedId)?.name ?? draftLabel);

  const pickDraft = () => {
    onSelectDraft();
    setOpen(false);
  };

  const pickEntry = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  const list = (
    <>
      <TabButton
        size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
        variant={TabButtonVariant.Regular}
        active={draftSelected}
        onClick={pickDraft}
      >
        <Icon iconName={IconName.Add} />
        <span className="text-left flex-grow truncate">{draftLabel}</span>
      </TabButton>
      {entries.length ? <Separator /> : null}
      {entries.map((entry) => (
        <TabButton
          key={entry.id}
          size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
          active={selectedId === entry.id}
          onClick={() => pickEntry(entry.id)}
        >
          <span className="text-left flex-grow truncate">{entry.name}</span>
        </TabButton>
      ))}
      {isLoading ? (
        <div className="flex items-center gap-2 px-2 py-1">
          <Loader size={LoaderSize.Micro} />
          <span className="text-micro text-basic-muted">Loading…</span>
        </div>
      ) : null}
    </>
  );

  if (isMobile) {
    return (
      <div className="shrink-0 border-b border-muted px-2 py-2">
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          placement={PopoverPlacement.BottomLeft}
          size="min-w-full"
          className="w-full"
          panelClassName="max-h-[50dvh] overflow-auto"
          content={<div className="flex flex-col gap-1 px-2">{list}</div>}
        >
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Large}
            content={ButtonContent.Icon}
            className="w-full"
            aria-expanded={open}
            aria-label="Choose configuration"
            onClick={() => setOpen((value) => !value)}
          >
            {draftSelected ? (
              <Icon iconName={IconName.Add} className="shrink-0" />
            ) : null}
            <span className="text-left flex-grow truncate">
              {selectedLabel}
            </span>
            <Icon
              iconName={IconName.Down}
              className={cn(
                "shrink-0 transition-transform duration-150 ease-out",
                open ? "rotate-180" : "rotate-0",
              )}
            />
          </Button>
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex flex-col shrink-0 gap-2 w-[240px] overflow-y-auto border-r border-muted px-2 py-4 [&>*]:shrink-0">
      {list}
    </div>
  );
}
