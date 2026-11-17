import { useState } from "react";
import {
  BoxSurface,
  Button,
  ButtonVariant,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Select,
} from "@/app/atoms";

const MODELS = [
  { id: "sonnet", label: "Claude Sonnet", icon: IconName.Brain },
  { id: "opus", label: "Claude Opus", icon: IconName.Brain },
  { id: "gpt", label: "GPT", icon: IconName.Ai },
];

interface InputsSectionProps {
  onOpenModal: () => void;
}

/** Fields share the button heights (32 / 40), a 10px corner and one calm focus ring. */
export function InputsSection({ onOpenModal }: InputsSectionProps) {
  const [model, setModel] = useState("sonnet");

  return (
    <BoxSurface title="Inputs">
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Input
            label="Working directory"
            inputSize={InputSize.Medium}
            placeholder="/Users/me/project"
            className="w-full max-w-[320px]"
          />
          <Input
            label="Search"
            inputSize={InputSize.Medium}
            leading={InputLeading.Icon}
            leadingIconName={IconName.Search}
            placeholder="Filter sessions"
            hintText="Matches name and cwd"
            className="w-full max-w-[280px]"
          />
          <Select
            items={MODELS}
            value={model}
            onValueChange={setModel}
            placeholder="Pick a model"
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Input
            label="Project name"
            placeholder="nac"
            hintText="Large: forms and dialogs. 44px on touch screens."
            className="w-full max-w-[320px]"
          />
          <Input
            label="Base URL"
            defaultValue="api.example"
            validation
            validationText="Enter a full URL, including https://"
            className="w-full max-w-[320px]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={ButtonVariant.Secondary} onClick={onOpenModal}>
            Open modal
          </Button>
          <span className="type-meta text-basic-tertiary">
            A confirmation dialog: 20px corners, 52px header, pill actions.
          </span>
        </div>
      </div>
    </BoxSurface>
  );
}
