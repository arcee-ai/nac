import type React from "react";
/** One chapter of the showcase: a quiet heading, a line of intent, its sections. */
export declare function ShowcaseGroup({ id, title, description, children, }: {
    id: string;
    title: string;
    description: string;
    children: React.ReactNode;
}): React.JSX.Element;
/** A labelled row inside a section: the caption on the left, specimens on the right. */
export declare function Specimen({ label, hint, className, children, }: {
    label: string;
    hint?: string;
    className?: string;
    children: React.ReactNode;
}): React.JSX.Element;
/** Token name set in the code face, for captions under a swatch or a ramp step. */
export declare function TokenName({ children }: {
    children: React.ReactNode;
}): React.JSX.Element;
