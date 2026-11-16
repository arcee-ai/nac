import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, ButtonVariant, Checkbox, Input, Select, TextArea } from "@/app/atoms";
import type { HeartbeatSpec, HeartbeatCalendarDraft } from "@/app/types/api";
import { useHeartbeatCalendarPreview } from "./queries";
import { CalendarPreview } from "./CalendarPreview";

type CadenceKind = "interval" | "daily" | "weekdays" | "weekly";
const cadences = [
  { id: "interval", label: "Elapsed interval" },
  { id: "daily", label: "Daily at local time" },
  { id: "weekdays", label: "Selected weekdays" },
  { id: "weekly", label: "Weekly" },
];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

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
  sessionId,
  initial,
  disabled,
  onSubmit,
  onCancel,
  freshTasks = false,
  children,
}: {
  initial?: HeartbeatSpec;
  disabled: boolean;
  onSubmit: (spec: HeartbeatSpec) => void;
  onCancel: () => void;
  children?: ReactNode;
} & ({ freshTasks: true; sessionId?: undefined } | { freshTasks?: false; sessionId: string })) {
  const [spec, setSpec] = useState<HeartbeatSpec>(initial ?? defaults);
  const { calendar: storedCalendar, interval_ms: storedInterval, ...common } = spec;
  const [mode, setMode] = useState<CadenceKind>(
    freshTasks ? "interval" : (storedCalendar?.days.kind ?? "interval"),
  );
  const [interval, setInterval] = useState((storedInterval ?? defaults.interval_ms) / 60000);
  const [zone, setZone] = useState(() => storedCalendar?.zone ?? deviceZone());
  const [localTime, setLocalTime] = useState(
    storedCalendar
      ? `${String(storedCalendar.hour).padStart(2, "0")}:${String(storedCalendar.minute).padStart(2, "0")}`
      : "09:00",
  );
  const [selectedDays, setDays] = useState<number[]>(
    storedCalendar?.days.kind === "weekdays"
      ? storedCalendar.days.days
      : storedCalendar?.days.kind === "weekly"
        ? [storedCalendar.days.day]
        : [1, 2, 3, 4, 5],
  );
  const draft = useMemo<HeartbeatCalendarDraft | null>(() => {
    if (mode === "interval" || !/^\d\d:\d\d$/.test(localTime) || !zone.trim()) return null;
    const [hour, minute] = localTime.split(":").map(Number);
    const days =
      mode === "daily"
        ? { kind: "daily" as const }
        : mode === "weekly"
          ? { kind: "weekly" as const, day: selectedDays[0] ?? 1 }
          : { kind: "weekdays" as const, days: selectedDays };
    return { zone, data_version: storedCalendar?.data_version ?? null, hour, minute, days };
  }, [mode, zone, localTime, selectedDays, storedCalendar?.data_version]);
  const preview = useHeartbeatCalendarPreview(sessionId, freshTasks ? null : draft);
  const ready =
    mode === "interval" ||
    (draft !== null && preview.data !== undefined && !preview.isFetching && !preview.error);
  const [skillsText, setSkillsText] = useState((initial?.skills ?? []).join(", "));
  const update = (patch: Partial<typeof common>) =>
    setSpec((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const commonSpec = freshTasks ? { ...common, goal_id: null } : common;
    if (mode === "interval") onSubmit({ ...commonSpec, interval_ms: Math.round(interval * 60000) });
    else if (!freshTasks && preview.data)
      onSubmit({ ...commonSpec, calendar: preview.data.calendar });
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={
        freshTasks
          ? initial
            ? "Edit interval task schedule"
            : "Create interval task schedule"
          : initial
            ? "Edit heartbeat"
            : "Create heartbeat"
      }
    >
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        {children}
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
        {!freshTasks && (
          <Select
            items={freshTasks ? cadences.filter((item) => item.id === "interval") : cadences}
            value={mode}
            onValueChange={(value) => setMode(value as CadenceKind)}
            triggerLabel={`Cadence: ${cadences.find((item) => item.id === mode)?.label}`}
            disabled={disabled}
            triggerClassName="w-full"
          />
        )}
        {mode === "interval" ? (
          <Input
            label="Interval (minutes)"
            aria-label="Interval in minutes"
            type="number"
            min={1}
            max={525600}
            step="any"
            value={interval}
            required
            onChange={(e) => setInterval(e.target.valueAsNumber)}
          />
        ) : (
          <>
            <Input
              label="Local time"
              aria-label="Local time"
              type="time"
              value={localTime}
              required
              onChange={(e) => setLocalTime(e.target.value)}
            />
            <Input
              label="IANA timezone"
              aria-label="IANA timezone"
              value={zone}
              required
              maxLength={128}
              onChange={(e) => setZone(e.target.value)}
              hintText="Saved with this schedule. Changing the viewing device's timezone does not change it."
            />
            {mode === "weekdays" ? (
              <fieldset className="flex flex-wrap gap-3">
                <legend className="label-small mb-2">Weekdays</legend>
                {weekdays.map((label, index) => (
                  <Checkbox
                    key={label}
                    aria-label={label}
                    checked={selectedDays.includes(index + 1)}
                    onChange={(checked) =>
                      setDays((current) =>
                        checked
                          ? [...current, index + 1].sort((a, b) => a - b)
                          : current.filter((day) => day !== index + 1),
                      )
                    }
                  >
                    {label}
                  </Checkbox>
                ))}
              </fieldset>
            ) : null}
            {mode === "weekly" ? (
              <Select
                items={weekdays.map((label, index) => ({ id: String(index + 1), label }))}
                value={String(selectedDays[0] ?? 1)}
                onValueChange={(day) => setDays([Number(day)])}
                triggerLabel={`Weekday: ${weekdays[(selectedDays[0] ?? 1) - 1]}`}
                disabled={disabled}
              />
            ) : null}
            {!draft ? (
              <p role="alert">Choose a local time and an explicit IANA timezone.</p>
            ) : preview.error ? (
              <p role="alert">{preview.error.message}</p>
            ) : preview.isFetching ? (
              <p role="status">Calculating upcoming checks…</p>
            ) : preview.data ? (
              <CalendarPreview preview={preview.data} />
            ) : null}
          </>
        )}
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
          label={freshTasks ? "Maximum tasks" : "Maximum checks"}
          aria-label={freshTasks ? "Maximum scheduled tasks" : "Maximum heartbeat checks"}
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
        {!freshTasks && (
          <Input
            label="Existing goal ID (optional)"
            aria-label="Existing goal ID"
            value={spec.goal_id ?? ""}
            onChange={(e) => update({ goal_id: e.target.value || null })}
            hintText="Leave empty for an ordinary check. A goal must already be active in this chat."
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={ButtonVariant.Primary} disabled={!ready}>
            {freshTasks
              ? initial
                ? "Save task schedule"
                : "Create task schedule"
              : initial
                ? "Save heartbeat"
                : "Create heartbeat"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </fieldset>
    </form>
  );
}
