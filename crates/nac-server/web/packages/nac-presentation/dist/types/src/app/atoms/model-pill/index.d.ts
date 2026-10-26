import type React from "react";
/** Pixel diameters of the avatar. */
export declare enum ModelPillSize {
    Small = 24,
    Medium = 32
}
interface ModelPillProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: ModelPillSize;
    /** Swaps the static rim for a spinner while the orchestrator is working. */
    active?: boolean;
}
/** Round avatar for the orchestrator, shown beside every model message. */
declare const ModelPill: React.FC<ModelPillProps> & {
    Size: typeof ModelPillSize;
};
export default ModelPill;
