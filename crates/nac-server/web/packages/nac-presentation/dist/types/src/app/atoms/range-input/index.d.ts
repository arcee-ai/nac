import React from "react";
interface RangeInputProps {
    min: number;
    max: number;
    value: number;
    onChange: (value: number) => void;
    step?: number;
    disabled?: boolean;
    label?: string;
    /** Keeps the 12px knob on the phone as well, for a slider inside a 16px row. */
    smallKnob?: boolean;
    className?: string;
}
/**
 * Slider on the input-progress tokens. The resting track uses the muted
 * progress colors; dragging or a held arrow key switches to the active ones.
 * The phone uses the taller knob unless `smallKnob` is set. Pointer capture
 * keeps the drag alive after the pointer leaves the track.
 */
declare const RangeInput: React.FC<RangeInputProps>;
export default RangeInput;
