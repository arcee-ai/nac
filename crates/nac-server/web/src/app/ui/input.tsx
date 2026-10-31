import type * as React from "react";

function Input({ type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" {...props} />;
}

export { Input };
