import React from "react";
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
/**
 * Slider on the input-progress tokens. The resting track uses the muted
 * progress colors; dragging or a held arrow key switches to the active ones.
 * The phone uses the taller knob. Pointer capture keeps the drag alive after
 * the pointer leaves the track.
 */
declare const RangeInput: React.FC<RangeInputProps>;
export default RangeInput;
