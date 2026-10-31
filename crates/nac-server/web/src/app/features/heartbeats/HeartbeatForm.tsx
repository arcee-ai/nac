import { useState, type FormEvent } from "react";
import { Button, ButtonVariant, Input, TextArea } from "@/app/atoms";
import type { HeartbeatSpec } from "@/app/types/api";

const defaults = {
  name: "",
  instructions: "",
  skills: [],
  interval_ms: 300000,
  end_condition: "Stop when the task is complete or human action is needed.",
  goal_id: null,
  execution_timeout_ms: 300000,
  max_occurrences: 1000,
  token_allowance: null,
} satisfies HeartbeatSpec;

export function HeartbeatForm({
  initial,
  disabled,
  onSubmit,
  onCancel,
}: {
  initial?: HeartbeatSpec;
  disabled: boolean;
  onSubmit: (spec: HeartbeatSpec) => void;
  onCancel: () => void;
}) {
  const [spec, setSpec] = useState<HeartbeatSpec>(initial ?? defaults);
  const [skillsText, setSkillsText] = useState((initial?.skills ?? []).join(", "));
  const update = (patch: Partial<HeartbeatSpec>) =>
    setSpec((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(spec);
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={initial ? "Edit heartbeat" : "Create heartbeat"}
    >
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <Input
          label="Name"
          aria-label="Heartbeat name"
          value={spec.name}
          required
          maxLength={120}
          onChange={(e) => update({ name: e.target.value })}
        />
        <TextArea
          label="Instructions"
          aria-label="Heartbeat instructions"
          value={spec.instructions}
          required
          maxLength={8000}
          onChange={(e) => update({ instructions: e.target.value })}
        />
        <Input
          label="Interval (minutes)"
          aria-label="Interval in minutes"
          type="number"
          min={1}
          max={525600}
          step="any"
          value={spec.interval_ms / 60000}
          required
          onChange={(e) => update({ interval_ms: Math.round(e.target.valueAsNumber * 60000) })}
        />
        <TextArea
          label="When to finish"
          aria-label="When to finish"
          value={spec.end_condition}
          required
          maxLength={1000}
          onChange={(e) => update({ end_condition: e.target.value })}
        />
        <Input
          label="Skills (comma separated names)"
          aria-label="Heartbeat skills"
          value={skillsText}
          onChange={(e) => {
            setSkillsText(e.target.value);
            update({
              skills: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            });
          }}
        />
        <Input
          label="Execution deadline (seconds)"
          aria-label="Execution deadline in seconds"
          type="number"
          min={1}
          max={3600}
          value={(spec.execution_timeout_ms ?? defaults.execution_timeout_ms) / 1000}
          required
          onChange={(e) =>
            update({ execution_timeout_ms: Math.round(e.target.valueAsNumber * 1000) })
          }
        />
        <Input
          label="Maximum checks"
          aria-label="Maximum heartbeat checks"
          type="number"
          min={1}
          max={100000}
          value={spec.max_occurrences ?? defaults.max_occurrences}
          required
          onChange={(e) => update({ max_occurrences: e.target.valueAsNumber })}
        />
        <Input
          label="Token allowance (optional)"
          aria-label="Heartbeat token allowance"
          type="number"
          min={1}
          value={spec.token_allowance ?? ""}
          onChange={(e) =>
            update({ token_allowance: e.target.value === "" ? null : e.target.valueAsNumber })
          }
        />
        <Input
          label="Existing goal ID (optional)"
          aria-label="Existing goal ID"
          value={spec.goal_id ?? ""}
          onChange={(e) => update({ goal_id: e.target.value || null })}
          hintText="Leave empty for an ordinary check. A goal must already be active in this chat."
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={ButtonVariant.Primary}>
            {initial ? "Save heartbeat" : "Create heartbeat"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </fieldset>
    </form>
  );
}
