import { useLayoutEffect, useRef } from "react";

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
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { newArgRow, type ArgRow } from "@/app/lib/mcpArgRows";

/** Ordered command arguments, one input per argument. */
export function ArgsEditor({
  label,
  itemLabel,
  rows,
  onChange,
}: {
  label: string;
  /** Names each row for assistive technology, e.g. "Argument" → "Argument 2". */
  itemLabel: string;
  rows: ArgRow[];
  onChange: (rows: ArgRow[]) => void;
}) {
  const isMobile = useIsMobile();
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const addSlot = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | "add" | null>(null);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") addSlot.current?.querySelector("button")?.focus();
    else inputs.current.get(target)?.focus();
  });

  const add = () => {
    const row = newArgRow();
    pendingFocus.current = row.id;
    onChange([...rows, row]);
  };
  const remove = (index: number) => {
    pendingFocus.current = (rows[index + 1] ?? rows[index - 1])?.id ?? "add";
    onChange(rows.filter((_, at) => at !== index));
  };
  const lower = itemLabel.toLowerCase();

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel label={label} />
      <p className="label-small text-basic-tertiary">
        Each field is one argument. Values are passed in this order.
      </p>
      {rows.length === 0 ? <p className="label-small text-basic-tertiary">No arguments.</p> : null}
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            ref={(element) => {
              if (element) inputs.current.set(row.id, element);
              else inputs.current.delete(row.id);
            }}
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            className="flex-1 min-w-0"
            inputClassName="font-mono"
            aria-label={`${itemLabel} ${index + 1}`}
            value={row.value}
            onChange={(event) =>
              onChange(
                rows.map((item) =>
                  item.id === row.id ? { ...item, value: event.target.value } : item,
                ),
              )
            }
          />
          <Button
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            variant={ButtonVariant.GhostDestructive}
            content={ButtonContent.Icon}
            aria-label={`Remove ${lower} ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Icon iconName={IconName.Trash} />
          </Button>
        </div>
      ))}
      <div ref={addSlot} className="flex flex-col">
        <TabButton
          type="button"
          size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
          className="!border !border-tertiary !border-dashed"
          onClick={add}
        >
          <Icon iconName={IconName.Add} />
          Add argument
        </TabButton>
      </div>
    </div>
  );
}
