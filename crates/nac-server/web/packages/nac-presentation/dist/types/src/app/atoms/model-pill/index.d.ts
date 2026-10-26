import type React from "react";
/** Line heights of the label. */
export declare enum ModelPillSize {
    /** Figma "Code/Code-small", the name over a reply. */
    Small = 20,
    Medium = 28
}
interface ModelPillProps extends React.HTMLAttributes<HTMLSpanElement> {
    size?: ModelPillSize;
    /** The model's name. */
    children: React.ReactNode;
}
/** The model behind a reply, as the mono label that heads it. */
declare const ModelPill: React.FC<ModelPillProps> & {
    Size: typeof ModelPillSize;
};
export default ModelPill;
