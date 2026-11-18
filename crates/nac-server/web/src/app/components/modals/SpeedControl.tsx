import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  type SelectItem,
} from "@/app/atoms";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useState, type ReactNode } from "react";
import {
  speedLabel,
  supportsSpeed,
  type DiscoveredTier,
  type ServiceTier,
} from "@/app/lib/serviceTier";

/** The form always offers a repair path; the composer only offers discovered acceleration. */
export function SpeedControl({
  tiers,
  value,
  onChange,
  disabled,
  form = false,
  openAiApi = false,
  fastContextLimit,
}: {
  tiers: DiscoveredTier[] | null;
  value: ServiceTier | null;
  onChange: (value: ServiceTier | null) => void;
  disabled?: boolean;
  form?: boolean;
  openAiApi?: boolean;
  /** Exclusive input-token limit documented for Fast mode, when applicable. */
  fastContextLimit?: number | null;
}) {
  const isMobile = useIsMobile();
  const [noteOpen, setNoteOpen] = useState(false);
  const fast = supportsSpeed(tiers, "fast");
  const ultra = supportsSpeed(tiers, "ultrafast");
  const note = openAiApi && (fast || ultra) && (
    <span className="text-xs text-muted-foreground">
      Higher token cost; subject to your OpenAI project’s access.{" "}
      <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">
        OpenAI pricing
      </a>
      {fast && fastContextLimit != null && (
        <>. Fast mode supports fewer than {fastContextLimit.toLocaleString()} input tokens.</>
      )}
    </span>
  );
  const withNote = (control: ReactNode) =>
    note ? (
      <div className="flex flex-wrap items-center gap-2">
        {control}
        {!form && isMobile ? (
          <Popover
            open={noteOpen}
            onClose={() => setNoteOpen(false)}
            sticky
            placement={PopoverPlacement.TopCenter}
            size={PopoverSize.Medium}
            focusScope="Speed pricing and access"
            content={<div className="p-3 leading-normal">{note}</div>}
          >
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Small}
              content={ButtonContent.Icon}
              className="min-h-11 min-w-11"
              aria-label="Speed pricing and access"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen(!noteOpen)}
            >
              <Icon iconName={IconName.Info} size={16} />
            </Button>
          </Popover>
        ) : (
          note
        )}
      </div>
    ) : (
      control
    );
  if (!form && !fast && !ultra) return null;
  if (!form && fast && !ultra) {
    return withNote(
      <Button
        className="max-md:min-h-11 max-md:min-w-11"
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        disabled={disabled}
        aria-label={`Speed: ${speedLabel(value)}`}
        aria-pressed={value === "fast"}
        onClick={() => onChange(value === "fast" ? "standard" : "fast")}
      >
        {value ? speedLabel(value) : "Default"}
      </Button>,
    );
  }
  const items: SelectItem[] = [
    { id: "", label: "Use provider default" },
    { id: "standard", label: "Standard" },
    ...(fast ? [{ id: "fast", label: "Fast" }] : []),
    ...(ultra ? [{ id: "ultrafast", label: "Ultrafast" }] : []),
  ];
  if (value && !supportsSpeed(tiers, value))
    items.push({ id: value, label: `${speedLabel(value)} (unavailable)` });
  return withNote(
    <SmallSelect
      aria-label={`Speed: ${speedLabel(value)}`}
      checkedChoices
      triggerClassName="max-md:min-h-11 max-md:min-w-11"
      presentation={form ? "form" : undefined}
      items={items}
      value={value ?? ""}
      placeholder="Provider default"
      triggerLabel={!form && !value ? "Default" : undefined}
      disabled={disabled}
      placement={PopoverPlacement.TopCenter}
      onValueChange={(id) => onChange((id || null) as ServiceTier | null)}
    />,
  );
}
