import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveCatalogModel } from "@/app/lib/catalog";
import type { ModelCatalog } from "@/app/types/api";

interface CompactionThresholdOptions {
  catalog: ModelCatalog | undefined;
  backend: string | null | undefined;
  model: string | null | undefined;
  initialValue?: number | null;
  onManualChange?: () => void;
}

interface CompactionThresholdState {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/** Keeps catalog-derived compaction suggestions separate from manual values. */
export function useCompactionThreshold({
  catalog,
  backend,
  model,
  initialValue,
  onManualChange,
}: CompactionThresholdOptions): CompactionThresholdState {
  const initial = initialValue == null ? "" : String(initialValue);
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const autoRef = useRef(initialValue == null);

  const placeholder = useMemo(() => {
    const contextWindow = resolveCatalogModel(
      catalog,
      backend,
      model,
    ).contextWindow;
    return contextWindow ? String(Math.round(contextWindow * 0.7)) : "auto";
  }, [catalog, backend, model]);

  useEffect(() => {
    if (
      placeholder !== "auto" &&
      (valueRef.current === "" || autoRef.current)
    ) {
      autoRef.current = true;
      valueRef.current = placeholder;
      setValue(placeholder);
    }
  }, [placeholder]);

  const onChange = useCallback(
    (next: string) => {
      onManualChange?.();
      autoRef.current = false;
      valueRef.current = next;
      setValue(next);
    },
    [onManualChange],
  );

  return { value, placeholder, onChange };
}
