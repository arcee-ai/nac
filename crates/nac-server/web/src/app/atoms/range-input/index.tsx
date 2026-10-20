import React, { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/cn";

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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Slider on the input-progress tokens. The resting track uses the muted
 * progress colors; dragging or a held arrow key switches to the active ones.
 * The phone uses the taller knob. Pointer capture keeps the drag alive after
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
  const [dragging, setDragging] = useState(false);
  const [keying, setKeying] = useState(false);
  const active = !disabled && (dragging || keying);

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
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured.
    }
    emitFromPointer(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    emitFromPointer(event.clientX);
  };

  const stopDragging = () => setDragging(false);

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
      setKeying(true);
      emit(value + delta);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setKeying(true);
      emit(min);
    }
    if (event.key === "End") {
      event.preventDefault();
      setKeying(true);
      emit(max);
    }
  };

  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

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
        "range-input relative w-full touch-none select-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={onKeyDown}
      onKeyUp={() => setKeying(false)}
      onBlur={() => {
        setDragging(false);
        setKeying(false);
      }}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full",
          active ? "bg-input-progress-bar" : "bg-input-progress-bar-disabled",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full",
          active ? "bg-input-progress" : "bg-input-progress-disabled",
        )}
        style={{ width: `${percent}%` }}
      />
      <div
        className="range-knob absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-input-knob"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
};

export default RangeInput;
