interface ManagedBranchPickerProps {
    branches: string[];
    value: string;
    onValueChange: (branch: string) => void;
    isLoading: boolean;
    error: string | null;
}
export declare function ManagedBranchPicker({ branches, value, onValueChange, isLoading, error, }: ManagedBranchPickerProps): import("react").JSX.Element;
export {};
