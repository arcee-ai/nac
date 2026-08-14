import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { FieldLabel } from "@/app/components/modals/ConfigRow";
import type { KvRow } from "@/app/lib/mcpKvRows";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

export function KvEditor({
  label,
  hint,
  keyPlaceholder,
  rows,
  onChange,
}: {
  label: string;
  hint: string;
  keyPlaceholder: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
}) {
  const isMobile = useIsMobile();
  const update = (index: number, patch: Partial<KvRow>) => {
    onChange(
      rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  };
  return (
    <div className="flex flex-col gap-4 md:gap-2">
      <FieldLabel label={label} hint={hint} />
      {rows.map((row, index) => (
        <div
          key={index}
          className="flex flex-col md:flex-row md:items-center gap-2 p-2 md:p-0 rounded-md bg-elevation-sublevel-variant-A shadow-convex md:shadow-none md:rounded-none md:bg-transparent"
        >
          <Input
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            className="flex-1 min-w-0"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            className="flex-1 min-w-0"
            placeholder={row.placeholder ?? "value"}
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.GhostDestructive}
            content={isMobile ? ButtonContent.IconLeft : ButtonContent.Icon}
            aria-label="Remove entry"
            onClick={() => onChange(rows.filter((_, at) => at !== index))}
            className={isMobile ? "self-end" : ""}
          >
            {isMobile ? "Remove" : null}
            <Icon iconName={IconName.Trash} />
          </Button>
        </div>
      ))}

      <TabButton
        size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
        className="!border !border-tertiary !border-dashed"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Icon iconName={IconName.Add} />
        Add entry
      </TabButton>
    </div>
  );
}
