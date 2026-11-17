import type React from "react";
export interface FileInputFile {
    id: string;
    name: string;
    size: string;
}
interface FileInputProps {
    multiple?: boolean;
    accept?: string;
    files?: FileInputFile[];
    errors?: string[];
    hint?: React.ReactNode;
    disabled?: boolean;
    onFilesSelected?: (files: File[]) => void;
    onRemove?: (id: string) => void;
    className?: string;
}
/** Drop target for one or more files, with the selected rows and error lines. */
declare const FileInput: React.FC<FileInputProps>;
export default FileInput;
