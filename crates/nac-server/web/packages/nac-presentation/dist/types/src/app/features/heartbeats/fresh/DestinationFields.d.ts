import type { FreshTaskDestination } from "../../../types/api";
export declare function DestinationFields({ value, onChange, git, savedDefaultRef, }: {
    value: FreshTaskDestination;
    onChange: (value: FreshTaskDestination) => void;
    git: boolean;
    savedDefaultRef: string | null;
}): import("react").JSX.Element;
