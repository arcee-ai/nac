import type * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

function Label(props: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" {...props} />;
}

export { Label };
