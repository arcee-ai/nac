/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCompactionThreshold } from "@/app/hooks/useCompactionThreshold";
import type { ModelCatalog } from "@/app/types/api";

function catalog(entries: Record<string, number>): ModelCatalog {
  return {
    catalog_version: 1,
    providers: [
      {
        id: "openai-responses",
        auth: "api_key_env",
        auth_status: "no_credential",
        auth_hint: null,
        managed_base_url: null,
        default_base_url: null,
        default_limits: {
          context_window: 0,
          max_tokens: 0,
          supported_efforts: [],
        },
        models: Object.entries(entries).map(([id, context_window]) => ({
          id,
          display_name: null,
          context_window,
          max_tokens: 0,
          cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          reasoning: false,
          supported_efforts: [],
          source: "baseline",
        })),
      },
    ],
  } as ModelCatalog;
}

const models = catalog({ first: 100, second: 201 });

describe("useCompactionThreshold", () => {
  it("fills an empty value from the catalog and rounds the 70% suggestion", () => {
    const { result } = renderHook(() =>
      useCompactionThreshold({
        catalog: models,
        backend: "openai-responses",
        model: "second",
      }),
    );
    expect(result.current).toMatchObject({ value: "141", placeholder: "141" });
  });

  it("fills when catalog data arrives asynchronously", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: ModelCatalog | undefined }) =>
        useCompactionThreshold({
          catalog: data,
          backend: "openai-responses",
          model: "first",
        }),
      { initialProps: { data: undefined as ModelCatalog | undefined } },
    );
    expect(result.current).toMatchObject({ value: "", placeholder: "auto" });
    rerender({ data: models });
    expect(result.current).toMatchObject({ value: "70", placeholder: "70" });
  });

  it("keeps persisted values manual while updating the placeholder", () => {
    const { result, rerender } = renderHook(
      ({ model, initialValue }) =>
        useCompactionThreshold({
          catalog: models,
          backend: "openai-responses",
          model,
          initialValue,
        }),
      { initialProps: { model: "first", initialValue: 42 } },
    );
    expect(result.current.value).toBe("42");
    rerender({ model: "second", initialValue: 99 });
    expect(result.current).toMatchObject({ value: "42", placeholder: "141" });
  });

  it("updates auto-generated values across known and unknown models", () => {
    const { result, rerender } = renderHook(
      ({ model }) =>
        useCompactionThreshold({ catalog: models, backend: "openai-responses", model }),
      { initialProps: { model: "first" } },
    );
    rerender({ model: "missing" });
    expect(result.current).toMatchObject({ value: "70", placeholder: "auto" });
    rerender({ model: "second" });
    expect(result.current).toMatchObject({ value: "141", placeholder: "141" });
  });

  it("preserves manual values, including empty until a suggestion changes", () => {
    const { result, rerender } = renderHook(
      ({ model }) =>
        useCompactionThreshold({ catalog: models, backend: "openai-responses", model }),
      { initialProps: { model: "first" } },
    );
    act(() => result.current.onChange("55"));
    rerender({ model: "second" });
    expect(result.current.value).toBe("55");
    act(() => result.current.onChange(""));
    expect(result.current.value).toBe("");
    rerender({ model: "first" });
    expect(result.current.value).toBe("70");
  });

  it("calls the manual callback for edits but never automatic updates", () => {
    const manual = vi.fn();
    const { result, rerender } = renderHook(
      ({ model }) =>
        useCompactionThreshold({
          catalog: models,
          backend: "openai-responses",
          model,
          onManualChange: manual,
        }),
      { initialProps: { model: "first" } },
    );
    rerender({ model: "second" });
    expect(manual).not.toHaveBeenCalled();
    act(() => result.current.onChange("1"));
    act(() => result.current.onChange(""));
    expect(manual).toHaveBeenCalledTimes(2);
  });
});
