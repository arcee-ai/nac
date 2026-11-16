import { ThemeSegmented } from "@/app/components/ThemeToggle";
import { cn } from "@/app/lib/cn";
import {
  setTranscriptDensity,
  useTranscriptDensity,
  type TranscriptDensity,
} from "@/app/store/transcriptDensityStore";
import { SettingsGroup, SettingsRow } from "../SettingsRows";

const DENSITIES: readonly { id: TranscriptDensity; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "detailed", label: "Detailed" },
];

function DensitySegmented() {
  const density = useTranscriptDensity();
  return (
    <div
      role="radiogroup"
      aria-label="Transcript density"
      className="inline-flex items-center gap-0.5 rounded-pill bg-[var(--f-wash-2)] p-0.5"
    >
      {DENSITIES.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={density === option.id}
          onClick={() => setTranscriptDensity(option.id)}
          className={cn(
            "type-label inline-flex h-7 items-center rounded-pill px-3 transition-colors duration-150 ease-out max-md:h-11 max-md:px-4",
            density === option.id
              ? "bg-elevation-level-1 text-basic-primary shadow-md"
              : "text-basic-tertiary hover:text-basic-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Settings › Appearance. Both choices are device preferences and save as you pick. */
export function AppearanceSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="Theme">
        <SettingsRow
          label="Color theme"
          hint="System follows your device's light or dark setting."
          control={<ThemeSegmented className="max-md:[&>button]:h-11 max-md:[&>button]:px-4" />}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Conversation"
        description="Approvals, questions and errors are always shown, whichever you pick."
      >
        <SettingsRow
          label="Transcript density"
          hint="Compact folds an agent's reasoning and tool steps into one “Worked for …” line; Detailed opens them."
          control={<DensitySegmented />}
        />
      </SettingsGroup>
    </div>
  );
}
