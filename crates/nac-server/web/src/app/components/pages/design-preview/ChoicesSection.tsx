import { useState } from "react";
import { BoxSurface, Checkbox, FileInput, type FileInputFile, Radio, TextArea } from "@/app/atoms";

const SAMPLE_FILES: FileInputFile[] = [{ id: "trace", name: "session-trace.txt", size: "12 KB" }];

function previewFile(file: File): FileInputFile {
  return {
    id: `${file.name}-${file.lastModified}`,
    name: file.name,
    size: `${Math.ceil(file.size / 1024)} KB`,
  };
}

export function ChoicesSection() {
  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState("first");
  const [files, setFiles] = useState<FileInputFile[]>(SAMPLE_FILES);

  return (
    <BoxSurface title="Choices, multi-line and file input">
      <div className="p-4 flex flex-wrap items-start gap-6">
        <div className="flex flex-col gap-2">
          <Checkbox checked={checked} onChange={setChecked}>
            Skip permission prompts
          </Checkbox>
          <Checkbox checked={false} onChange={() => {}} disabled>
            Disabled
          </Checkbox>
        </div>
        <div className="flex flex-col gap-2">
          <Radio
            name="preview-choice"
            checked={choice === "first"}
            onChange={() => setChoice("first")}
          >
            Working tree
          </Radio>
          <Radio
            name="preview-choice"
            checked={choice === "second"}
            onChange={() => setChoice("second")}
          >
            Latest snapshot
          </Radio>
        </div>
        <TextArea
          label="System prompt"
          rows={3}
          placeholder="Extra instructions for the agent"
          className="w-[320px]"
        />
        <div className="flex w-[320px] flex-col gap-2">
          <FileInput
            accept=".txt,.md,.pdf"
            hint="Text, Markdown or PDF."
            onFilesSelected={(selected) => setFiles(selected.map(previewFile))}
          />
          <FileInput
            files={files}
            onRemove={(id) => setFiles(files.filter((file) => file.id !== id))}
          />
        </div>
      </div>
    </BoxSurface>
  );
}
