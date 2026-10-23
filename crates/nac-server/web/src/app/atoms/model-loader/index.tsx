import type React from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { cn } from "../../lib/cn";

/** Box sizes from the Figma ModelLoader: 16, 20 and 24px. */
export enum ModelLoaderSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

export enum ModelLoaderVariant {
  Default = "default",
  Accent = "accent",
}

/** One of the Figma example frames (Example#1–3). */
export type ModelLoaderFrame = 1 | 2 | 3;

interface ModelLoaderProps {
  size?: ModelLoaderSize;
  variant?: ModelLoaderVariant;
  /** Freezes the grid on an example frame instead of animating it. */
  frame?: ModelLoaderFrame;
  /** Announces the loader as a status. Without one it is decorative. */
  label?: string;
  className?: string;
}

/**
 * Every size keeps a 1px inset and 2px gaps; only the dots grow. Pixels, not
 * rem, so the box always matches the pixel-sized icon it stands in for.
 */
const GEOMETRY: Record<ModelLoaderSize, { box: string; dot: string }> = {
  [ModelLoaderSize.Small]: { box: "size-[16px]", dot: "size-[2px]" },
  [ModelLoaderSize.Medium]: { box: "size-[20px]", dot: "size-[3px]" },
  [ModelLoaderSize.Large]: { box: "size-[24px]", dot: "size-[4px]" },
};

const DOT_TONE: Record<ModelLoaderVariant, string> = {
  [ModelLoaderVariant.Default]: "bg-btn-primary",
  [ModelLoaderVariant.Accent]: "bg-accent-inverse",
};

/** Indexed by dot level: hidden, half, full. */
const DOT_OPACITY = ["opacity-0", "opacity-25", "opacity-100"];

const DOT_OPACITY_VALUE = [0, 0.25, 1];

const TICK_MS = 400;

/** Ticks before a dot's random sequence repeats. */
const LOOP_TICKS = 16;

/** Starts and ends at rest, so back-to-back ticks join without a jerk. */
const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Row by row, as levels into `DOT_OPACITY`. */
const FRAMES: Record<ModelLoaderFrame, number[]> = {
  1: [
    [2, 1, 2, 0],
    [0, 2, 0, 1],
    [1, 2, 1, 0],
    [0, 1, 1, 2],
  ].flat(),
  2: [
    [0, 2, 1, 1],
    [2, 1, 1, 2],
    [0, 0, 2, 1],
    [1, 2, 2, 0],
  ].flat(),
  3: [
    [1, 0, 0, 2],
    [1, 0, 2, 0],
    [2, 1, 0, 2],
    [2, 0, 0, 1],
  ].flat(),
};

/** The animation starts from, and every loop returns to, this frame. */
const REST_FRAME: ModelLoaderFrame = 1;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const reducedMotionQuery = () =>
  typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;

const subscribeToReducedMotion = (onChange: () => void) => {
  const query = reducedMotionQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

const prefersReducedMotion = () => reducedMotionQuery()?.matches ?? false;

const randomLevel = () => Math.floor(Math.random() * DOT_OPACITY_VALUE.length);

/** A random level per tick, starting from and looping back to `level`. */
const dotKeyframes = (level: number): Keyframe[] =>
  [level, ...Array.from({ length: LOOP_TICKS - 1 }, randomLevel), level].map((tickLevel, tick) => ({
    offset: tick / LOOP_TICKS,
    opacity: DOT_OPACITY_VALUE[tickLevel],
    easing: EASE_IN_OUT,
  }));

/**
 * The "model is working" indicator: a 4×4 dot grid whose dots reshuffle their
 * opacity every tick. The box never changes size, so swapping it in for an
 * icon of the same size does not move the layout.
 *
 * The animation runs on the Web Animations API, so a tick never re-renders.
 * An explicit `frame` or a reduced-motion preference leaves a still frame.
 */
const ModelLoader: React.FC<ModelLoaderProps> & {
  Size: typeof ModelLoaderSize;
  Variant: typeof ModelLoaderVariant;
} = ({
  size = ModelLoaderSize.Medium,
  variant = ModelLoaderVariant.Default,
  frame,
  label,
  className = "",
}) => {
  const gridRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
    prefersReducedMotion,
  );
  const animated = frame === undefined && !reducedMotion;

  useEffect(() => {
    const grid = gridRef.current;
    if (!animated || typeof grid?.animate !== "function") return;
    const animations = Array.from(grid.children, (dot, index) =>
      dot.animate(dotKeyframes(FRAMES[REST_FRAME][index]), {
        duration: LOOP_TICKS * TICK_MS,
        // Dots that change in unison read as a stutter.
        delay: Math.random() * TICK_MS,
        iterations: Infinity,
      }),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [animated]);

  const { box, dot } = GEOMETRY[size];

  return (
    <span
      ref={gridRef}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-variant={variant}
      data-frame={frame}
      className={cn("grid shrink-0 grid-cols-4 grid-rows-4 gap-[2px] p-px", box, className)}
    >
      {FRAMES[frame ?? REST_FRAME].map((level, index) => (
        <span
          key={index}
          className={cn("rounded-[1px]", dot, DOT_TONE[variant], DOT_OPACITY[level])}
        />
      ))}
    </span>
  );
};

ModelLoader.Size = ModelLoaderSize;
ModelLoader.Variant = ModelLoaderVariant;

export default ModelLoader;
