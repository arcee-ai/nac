import { Button, ButtonSize, ButtonVariant, PopoverPlacement, type SelectItem } from "@/app/atoms";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
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
}: {
  tiers: DiscoveredTier[] | null;
  value: ServiceTier | null;
  onChange: (value: ServiceTier | null) => void;
  disabled?: boolean;
  form?: boolean;
}) {
  const fast = supportsSpeed(tiers, "fast");
  const ultra = supportsSpeed(tiers, "ultrafast");
  if (!form && !fast && !ultra) return null;
  if (!form && fast && !ultra) {
    return (
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
      </Button>
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
  return (
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
    />
  );
}
