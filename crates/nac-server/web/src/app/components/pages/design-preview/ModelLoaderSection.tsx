import { Fragment } from "react";
import {
  BoxSurface,
  ModelLoader,
  type ModelLoaderFrame,
  ModelLoaderSize,
  ModelLoaderVariant,
} from "@/app/atoms";

const VARIANTS = [
  { variant: ModelLoaderVariant.Default, label: "Default" },
  { variant: ModelLoaderVariant.Accent, label: "Accent" },
];

const SIZES = [
  { size: ModelLoaderSize.Small, label: "Small 16px" },
  { size: ModelLoaderSize.Medium, label: "Medium 20px" },
  { size: ModelLoaderSize.Large, label: "Large 24px" },
];

const FRAMES: ModelLoaderFrame[] = [1, 2, 3];

export function ModelLoaderSection() {
  return (
    <BoxSurface title="Model loader">
      <div className="p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3">
        <span />
        <span className="label-micro text-basic-muted">Animated</span>
        {FRAMES.map((frame) => (
          <span key={frame} className="label-micro text-basic-muted">
            Frame {frame}
          </span>
        ))}
        {VARIANTS.flatMap(({ variant, label }) =>
          SIZES.map(({ size, label: sizeLabel }) => (
            <Fragment key={`${variant}-${size}`}>
              <span className="label-small text-basic-secondary">
                {label} · {sizeLabel}
              </span>
              <ModelLoader size={size} variant={variant} />
              {FRAMES.map((frame) => (
                <ModelLoader key={frame} size={size} variant={variant} frame={frame} />
              ))}
            </Fragment>
          )),
        )}
      </div>
    </BoxSurface>
  );
}
