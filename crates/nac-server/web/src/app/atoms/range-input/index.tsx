import React, { useCallback, useRef } from "react";
import { cn } from "../../lib/cn";

const KNOB_RADIUS_PX = 8;

interface RangeInputProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  disabled?: boolean;
  label?: string;
  className?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Slider on the input-progress tokens. Dragging goes through pointer events, so
 * mouse, pen and touch share one path and the capture keeps tracking even when
 * the pointer leaves the track.
 */
const RangeInput: React.FC<RangeInputProps> = ({
  min,
  max,
  value,
  onChange,
  step = 1,
  disabled = false,
  label,
  className = "",
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  const emit = useCallback(
    (next: number) => {
      const snapped = Math.round(next / step) * step;
      // Snapping can land a hair outside the bounds, and floating point steps
      // leave trailing noise that would show up in a bound text field.
      const bounded = clamp(snapped, min, max);
      const rounded = Number(bounded.toFixed(4));
      if (rounded !== value) onChange(rounded);
    },
    [step, min, max, value, onChange],
  );

  const emitFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      emit(min + ratio * (max - min));
    },
    [emit, min, max],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    emitFromPointer(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    emitFromPointer(event.clientX);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -step
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? step
          : 0;
    if (delta) {
      event.preventDefault();
      emit(value + delta);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      emit(min);
    }
    if (event.key === "End") {
      event.preventDefault();
      emit(max);
    }
  };

  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  // Keeps the knob inside the track at both ends instead of hanging over.
  const knobOffset = KNOB_RADIUS_PX * (1 - (2 * percent) / 100);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label ?? "Range"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      className={cn(
        "group relative h-1 w-full rounded-full outline-none touch-none select-none",
        disabled
          ? "bg-input-progress-bar-disabled cursor-not-allowed"
          : "bg-input-progress-bar cursor-pointer",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          disabled ? "bg-input-progress-disabled" : "bg-input-progress",
        )}
        style={{ width: `${percent}%` }}
      />
      <div
        className={cn(
          "absolute top-1/2 w-4 h-4 rounded-full shadow-md -translate-y-1/2 -translate-x-1/2",
          disabled
            ? "bg-input-knob-disabled"
            : "bg-input-knob group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-accent-primary",
        )}
        style={{ left: `calc(${percent}% + ${knobOffset}px)` }}
      />
    </div>
  );
};

export default RangeInput;
