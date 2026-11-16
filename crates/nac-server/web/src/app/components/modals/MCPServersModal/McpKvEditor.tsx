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
import type { KvRow } from "@/app/lib/mcpKvRows";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

export function KvEditor({
  label,
  hint,
  keyPlaceholder,
  rows,
  onChange,
  secret = true,
}: {
  label: string;
  hint: string;
  keyPlaceholder: string;
  secret?: boolean;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
}) {
  const isMobile = useIsMobile();
  const keys = useRef(new Map<number, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | "add" | null>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "add") addButton.current?.focus();
    else if (target !== null) keys.current.get(target)?.focus();
  });
  const update = (index: number, patch: Partial<KvRow>) => {
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FieldLabel label={label} />
      <p className="text-small !leading-[22px] text-basic-secondary">{hint}</p>
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] items-center gap-2 border-b border-muted pb-3 md:border-0 md:pb-0"
        >
          <Input
            ref={(element) => {
              if (element) keys.current.set(index, element);
              else keys.current.delete(index);
            }}
            aria-label={`${label} key ${index + 1}`}
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            className="min-w-0 col-start-1"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            aria-label={`${label} value ${index + 1}`}
            type={secret ? "password" : "text"}
            autoComplete="off"
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            className="min-w-0 col-start-1 md:col-start-2"
            placeholder={row.placeholder ?? "value"}
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            variant={ButtonVariant.GhostDestructive}
            content={ButtonContent.Icon}
            aria-label={`Remove ${label.toLowerCase()} entry ${index + 1}`}
            onClick={() => {
              pendingFocus.current = rows.length === 1 ? "add" : Math.min(index, rows.length - 2);
              onChange(rows.filter((_, at) => at !== index));
            }}
            className="col-start-2 row-start-1 row-span-2 md:col-start-3 md:row-span-1"
          >
            <Icon iconName={IconName.Trash} />
          </Button>
        </div>
      ))}

      <TabButton
        ref={addButton}
        type="button"
        size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
        className="!border !border-tertiary !border-dashed"
        onClick={() => {
          pendingFocus.current = rows.length;
          onChange([...rows, { key: "", value: "" }]);
        }}
      >
        <Icon iconName={IconName.Add} />
        Add entry
      </TabButton>
    </div>
  );
}
