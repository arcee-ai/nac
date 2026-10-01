import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { SteeringPromptModal } from "@/app/components/inspector/SteeringPromptModal";
import { ClientRequestError } from "@/app/effect/errors";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { steerThreadAtom } from "@/app/services/queries";

export function ThreadSteeringModal({
  sessionId,
  threadName,
  onClose,
}: {
  sessionId: string;
  threadName: string;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const steerThread = useAtomSet(steerThreadAtom, { mode: "promise" });
  const steering = useAtomValue(steerThreadAtom).waiting;
  const toast = useToast();

  const submit = async () => {
    const prompt = instruction.trim();
    if (!prompt) {
      toast.error("A steering message is required.");
      return;
    }
    try {
      await steerThread({ id: sessionId, threadName, instruction: prompt });
      setInstruction("");
      onClose();
    } catch (error) {
      const cause = error instanceof ClientRequestError ? error.error : error;
      toast.error(`Unable to steer ${threadName}: ${errorMessage(toRunError(cause))}`);
    }
  };

  return (
    <SteeringPromptModal
      open
      title={`Steer ${threadName}`}
      value={instruction}
      submitting={steering}
      onChange={setInstruction}
      onClose={onClose}
      onSubmit={() => void submit()}
    />
  );
}
