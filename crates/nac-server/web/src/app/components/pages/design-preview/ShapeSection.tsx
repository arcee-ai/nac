import { useState } from "react";
import { BoxSurface, Button, ButtonVariant } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { Specimen, TokenName } from "@/app/components/pages/design-preview/Showcase";

const RADII = [
  { name: "rounded-xs", px: 4, use: "ticks" },
  { name: "rounded-sm", px: 6, use: "chips in rows" },
  { name: "rounded-md", px: 8, use: "rows, tooltips" },
  { name: "rounded-lg", px: 10, use: "inputs" },
  { name: "rounded-card", px: 14, use: "cards, popovers" },
  { name: "rounded-sheet", px: 20, use: "dialogs, sheets" },
  { name: "rounded-composer", px: 22, use: "composer" },
  { name: "rounded-pill", px: 9999, use: "controls, chips" },
];

const RADIUS_CLASS: Record<string, string> = {
  "rounded-xs": "rounded-xs",
  "rounded-sm": "rounded-sm",
  "rounded-md": "rounded-md",
  "rounded-lg": "rounded-lg",
  "rounded-card": "rounded-card",
  "rounded-sheet": "rounded-sheet",
  "rounded-composer": "rounded-composer",
  "rounded-pill": "rounded-pill",
};

const LAYERS = [
  { name: "Ground", className: "bg-elevation-ground border border-tertiary", token: "page" },
  { name: "Surface", className: "bg-elevation-level-1 border border-tertiary", token: "cards" },
  { name: "Popover", className: "bg-elevation-level-3 shadow-lg", token: "shadow-lg" },
  { name: "Dialog", className: "bg-elevation-level-2 shadow-2xl", token: "shadow-2xl" },
];

const DURATIONS = [
  { name: "--dur-fast", value: "120ms", use: "hover, press, colour" },
  { name: "--dur-base", value: "160ms", use: "popovers, toasts" },
  { name: "--dur-slow", value: "200ms", use: "drawers, sheets" },
];

/** Radius scale, elevation and motion: the shape of every surface. */
export function ShapeSection() {
  const [moved, setMoved] = useState(false);
  return (
    <BoxSurface title="Shape, elevation and motion">
      <Specimen label="Radius" hint="One scale. Controls are pills; boxes step up.">
        <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-5">
          {RADII.map((radius) => (
            <div key={radius.name} className="flex min-w-0 flex-col gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "h-12 w-full border border-secondary bg-elevation-sublevel-variant-A",
                  RADIUS_CLASS[radius.name],
                )}
              />
              <code className="truncate font-mono text-2xs text-basic-secondary">
                {radius.name}
              </code>
              <span className="type-meta text-basic-muted">
                {radius.px === 9999 ? "full" : `${radius.px}px`} · {radius.use}
              </span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen label="Elevation" hint="Hairlines at rest; shadows only on floating layers.">
        <div className="flex flex-wrap gap-4 rounded-card bg-elevation-ground p-4">
          {LAYERS.map((layer) => (
            <div
              key={layer.name}
              className={cn(
                "flex h-20 w-[132px] flex-col justify-end rounded-card p-3",
                layer.className,
              )}
            >
              <span className="type-label text-basic-primary">{layer.name}</span>
              <TokenName>{layer.token}</TokenName>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen label="Motion" hint="Quick ease-out, never bouncy; reduced motion turns it off.">
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap gap-4">
            {DURATIONS.map((duration) => (
              <div key={duration.name} className="flex flex-col">
                <TokenName>{duration.name}</TokenName>
                <span className="type-meta text-basic-tertiary">
                  {duration.value} · {duration.use}
                </span>
              </div>
            ))}
          </div>
          <div className="relative h-10 w-full max-w-[420px] rounded-pill bg-elevation-sublevel-variant-A">
            <span
              aria-hidden
              className="absolute top-1 size-8 rounded-pill bg-btn-primary transition-[left] duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none"
              style={{ left: moved ? "calc(100% - 36px)" : "4px" }}
            />
          </div>
          <div>
            <Button variant={ButtonVariant.Secondary} onClick={() => setMoved((value) => !value)}>
              Play drawer easing
            </Button>
          </div>
        </div>
      </Specimen>
    </BoxSurface>
  );
}
