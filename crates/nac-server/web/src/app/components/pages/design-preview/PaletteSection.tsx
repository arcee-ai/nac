import { BoxSurface } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

interface Swatch {
  name: string;
  token: string;
  /** Draw the token as a hairline instead of a fill. */
  line?: boolean;
}

const ROWS: { label: string; note: string; swatches: Swatch[] }[] = [
  {
    label: "Surfaces",
    note: "Warm paper; elevation is a step of lightness plus a hairline.",
    swatches: [
      { name: "Ground", token: "--f-ground" },
      { name: "Sidebar", token: "--f-sidebar" },
      { name: "Surface", token: "--f-surface" },
      { name: "Overlay", token: "--f-overlay" },
    ],
  },
  {
    label: "Ink",
    note: "Primary actions are ink. There is no brand hue in chrome.",
    swatches: [
      { name: "Primary", token: "--f-ink" },
      { name: "Secondary", token: "--f-ink-2" },
      { name: "Tertiary", token: "--f-ink-3" },
      { name: "Muted", token: "--f-ink-4" },
      { name: "Faint", token: "--f-ink-5" },
    ],
  },
  {
    label: "Washes and lines",
    note: "Ink at low alpha: hovers, selection and hairlines that work on any surface.",
    swatches: [
      { name: "Wash 1", token: "--f-wash-1" },
      { name: "Wash 2", token: "--f-wash-2" },
      { name: "Wash 3", token: "--f-wash-3" },
      { name: "Line", token: "--f-line", line: true },
      { name: "Strong line", token: "--f-line-strong", line: true },
    ],
  },
  {
    label: "Signals",
    note: "Colour only ever means something.",
    swatches: [
      { name: "Needs you", token: "--f-amber" },
      { name: "Failed", token: "--f-red" },
      { name: "Done, added", token: "--f-green" },
      { name: "Link", token: "--f-blue" },
    ],
  },
];

function SwatchChip({ swatch }: { swatch: Swatch }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        aria-hidden
        className={cn(
          "h-10 w-full rounded-md",
          swatch.line ? "border-2" : "shadow-[inset_0_0_0_1px_var(--f-line)]",
        )}
        style={
          swatch.line
            ? { borderColor: `var(${swatch.token})`, background: "var(--f-surface)" }
            : { background: `var(${swatch.token})` }
        }
      />
      <span className="type-meta-strong mt-0.5 truncate text-[var(--f-ink)]">{swatch.name}</span>
      <code className="truncate font-mono text-2xs text-[var(--f-ink-3)]">{swatch.token}</code>
    </div>
  );
}

/** One theme's palette, scoped by its own `.light` / `.dark` class. */
function PalettePanel({ mode }: { mode: "light" | "dark" }) {
  return (
    <div
      className={cn(
        mode,
        "flex min-w-0 flex-1 flex-col gap-5 rounded-card border border-[var(--f-line)] bg-[var(--f-ground)] p-4 text-[var(--f-ink)]",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-strong">{mode === "light" ? "Light" : "Dark"}</span>
        <span className="type-meta text-[var(--f-ink-3)]">
          {mode === "light" ? "Ink on warm paper" : "Designed, not inverted"}
        </span>
      </div>
      {ROWS.map((row) => (
        <div key={row.label} className="flex flex-col gap-2">
          <span className="type-meta-strong text-[var(--f-ink-3)]">{row.label}</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-2.5 gap-y-3">
            {row.swatches.map((swatch) => (
              <SwatchChip key={swatch.token} swatch={swatch} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Both themes at once, so a token is always judged in light and in dark. */
export function PaletteSection() {
  return (
    <BoxSurface title="Palette">
      <div className="flex flex-col gap-4 p-4">
        <ul className="type-body-chrome flex flex-col gap-1 text-basic-secondary">
          {ROWS.map((row) => (
            <li key={row.label}>
              <span className="text-basic-primary">{row.label}.</span> {row.note}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-4 lg:flex-row">
          <PalettePanel mode="light" />
          <PalettePanel mode="dark" />
        </div>
      </div>
    </BoxSurface>
  );
}
