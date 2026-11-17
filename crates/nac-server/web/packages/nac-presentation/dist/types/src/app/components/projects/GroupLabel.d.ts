/**
 * Heading for a group of rows, in the form the model catalog uses: the name,
 * then a rule filling whatever the name leaves of the line, sitting on the
 * name's baseline.
 *
 * Spacing is the caller's, because a heading between rows of a padded list and
 * one between grids of cards sit to different edges.
 */
export declare function GroupLabel({ children, className }: {
    children: string;
    className?: string;
}): import("react").JSX.Element;
