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

export function InputsSection({ onOpenModal }: InputsSectionProps) {
  const [model, setModel] = useState("sonnet");

  return (
    <BoxSurface title="Inputs">
      <div className="p-4 flex flex-wrap items-end gap-4">
        <Input
          label="Working directory"
          inputSize={InputSize.Medium}
          placeholder="/Users/me/project"
          className="w-[320px]"
        />
        <Input
          label="Search"
          inputSize={InputSize.Medium}
          leading={InputLeading.Icon}
          leadingIconName={IconName.Search}
          placeholder="Filter sessions"
          hintText="Matches name and cwd"
          className="w-[280px]"
        />
        <Select items={MODELS} value={model} onValueChange={setModel} placeholder="Pick a model" />
        <Button variant={ButtonVariant.Secondary} onClick={onOpenModal}>
          Open modal
        </Button>
      </div>
    </BoxSurface>
  );
}
