import { describe, expect, it } from "vitest";

import {
  displayPromptFromMessageText,
  displaySessionTitle,
} from "@/app/lib/format";
import type { SessionSummarySnapshot } from "@/app/types/api";

// Mirrors the expansion format of `expand_user_prompt` in nac-core
// `commands.rs`: `{raw}\n\n<invoked_skills>\n{blocks joined by \n}\n</invoked_skills>`.
function skillBlock(name: string, body: string): string {
  return `<skill_content name="${name}">\n${body}\n\n</skill_content>`;
}

function expand(raw: string, ...blocks: string[]): string {
  return `${raw}\n\n<invoked_skills>\n${blocks.join("\n")}\n</invoked_skills>`;
}

function summaryWithPrompt(prompt: string | null): SessionSummarySnapshot {
  // SAFETY: test fixture — displaySessionTitle only reads `title`,
  // `last_user_prompt` and `session_id`, so the remaining fields are omitted.
  return {
    session_id: "session-abcdef1234567890",
    last_user_prompt: prompt,
  } as SessionSummarySnapshot;
}

describe("displayPromptFromMessageText", () => {
  it("collapses a single-skill expansion back to the raw prompt", () => {
    const raw = "Use $demo to review this change.";
    const expanded = expand(raw, skillBlock("demo", "DEMO BODY"));
    expect(displayPromptFromMessageText(expanded)).toBe(raw);
  });

  it("collapses a multi-skill expansion", () => {
    const raw = "multi\nline $alpha prompt\nwith $beta too";
    const expanded = expand(
      raw,
      skillBlock("alpha", "ALPHA BODY"),
      skillBlock("beta", "BETA BODY"),
    );
    expect(displayPromptFromMessageText(expanded)).toBe(raw);
  });

  it("collapses an expansion whose raw prompt mentions the sentinel", () => {
    const raw =
      "mentions <invoked_skills> and <skill_content in prose, uses $alpha";
    const expanded = expand(raw, skillBlock("alpha", "ALPHA BODY"));
    expect(displayPromptFromMessageText(expanded)).toBe(raw);
  });

  it("leaves prose that merely mentions the sentinel unchanged", () => {
    const prose = "the <invoked_skills> element wraps appended skills";
    expect(displayPromptFromMessageText(prose)).toBe(prose);
  });

  it("leaves a trailing closing tag without the separator unchanged", () => {
    const prose = "user text that ends with </invoked_skills>";
    expect(displayPromptFromMessageText(prose)).toBe(prose);
  });

  it("collapses at the last separator when the message ends with the closing tag", () => {
    // Accepted imprecision, matching the Rust collapse: a message that ends
    // with the closing tag and contains the separator is treated as expanded
    // even when the separator appears in user prose.
    const text =
      "notes\n\n<invoked_skills>\nmore prose\n</invoked_skills>";
    expect(displayPromptFromMessageText(text)).toBe("notes");
  });

  it("still collapses legacy /plan and /run command messages", () => {
    const expandedPlan =
      "# /plan: Workset Planning\n\nUser instruction:\nsplit this into reviewable units\n\nCreate exactly one durable high-level workset with `workset_define`.";
    const expandedRun =
      "# /run: Workset Execution\n\nWorkset id:\nauth-refresh\n\nExecute an existing workset.";
    expect(displayPromptFromMessageText(expandedPlan)).toBe(
      "/plan split this into reviewable units",
    );
    expect(displayPromptFromMessageText(expandedRun)).toBe("/run auth-refresh");
  });

  it("returns empty for nullish content and leaves plain text unchanged", () => {
    expect(displayPromptFromMessageText(null)).toBe("");
    expect(displayPromptFromMessageText(undefined)).toBe("");
    expect(displayPromptFromMessageText("just a prompt")).toBe("just a prompt");
  });
});

describe("displaySessionTitle", () => {
  it("collapses an expanded last_user_prompt back to the raw prompt", () => {
    const raw = "Use $demo to review this change.";
    const summary = summaryWithPrompt(expand(raw, skillBlock("demo", "BODY")));
    expect(displaySessionTitle(summary)).toBe(raw);
  });

  it("prefers an explicit title over the prompt", () => {
    const summary = {
      ...summaryWithPrompt(expand("raw $demo", skillBlock("demo", "BODY"))),
      title: "  My title  ",
    };
    expect(displaySessionTitle(summary)).toBe("My title");
  });

  it("falls back to the short session id without a title or prompt", () => {
    expect(displaySessionTitle(summaryWithPrompt(null))).toBe(
      "session-:7890",
    );
  });
});
