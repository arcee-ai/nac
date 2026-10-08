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
 * Slider on the input-progress tokens. Dragging goes through pointer events, so
 * mouse, pen and touch share one path and the capture keeps tracking even when
 * the pointer leaves the track.
 */
declare const RangeInput: React.FC<RangeInputProps>;
export default RangeInput;
