import { useEffect, useRef, useState } from "react";

import { Button, ButtonContent, ButtonSize, ButtonVariant } from "@/app/atoms";
import type { RuntimeGuidance } from "@/app/store/runtimeStore";

interface GuidanceControlProps {
  active: boolean;
  pending: boolean;
  status: RuntimeGuidance | null;
  onSubmit: (instruction: string) => Promise<boolean>;
}

const statusText = (status: RuntimeGuidance) => {
  switch (status.status) {
    case "queued":
      return "Guidance queued";
    case "delivered":
      return "Guidance delivered";
    case "expired":
      return "Guidance expired before delivery";
    case "error":
      return status.message
        ? `Guidance error: ${status.message}`
        : "Guidance error";
  }
};

/** A separate draft: ordinary Send remains a queued next turn, never guidance. */
export function GuidanceControl({
  active,
  pending,
  status,
  onSubmit,
}: GuidanceControlProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <div className="flex flex-col items-start gap-2">
      {active ? (
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.GhostAccent}
          content={ButtonContent.Text}
          aria-expanded={open}
          aria-controls="current-run-guidance"
          onClick={() => setOpen((shown) => !shown)}
        >
          Guide current run
        </Button>
      ) : null}
      {active && open ? (
        <div id="current-run-guidance" className="w-full flex flex-col gap-2">
          <label
            className="text-small text-basic-secondary"
            htmlFor="guidance-input"
          >
            Guidance for the active run
          </label>
          <textarea
            id="guidance-input"
            ref={input}
            rows={2}
            className="w-full input rounded-[4px] p-3 text-small resize-y"
            placeholder="What should the current run do differently?"
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="label-micro text-basic-tertiary">
            Applied after the current model call or tool batch.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.SecondaryAccent}
              loading={pending}
              disabled={!value.trim()}
              onClick={() => {
                void onSubmit(value.trim()).then((accepted) => {
                  if (accepted) {
                    setValue("");
                    setOpen(false);
                  }
                });
              }}
            >
              Apply guidance
            </Button>
          </div>
        </div>
      ) : null}
      {status ? (
        <p role="status" className="label-micro text-basic-tertiary">
          {statusText(status)}
        </p>
      ) : null}
    </div>
  );
}
