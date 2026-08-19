import { describe, expect, it } from "vitest";

import {
  displayPromptFromMessageText,
  displaySessionTitle,
  INVOKED_SKILLS_CLOSE,
  INVOKED_SKILLS_OPEN,
  INVOKED_SKILLS_SEPARATOR,
  invokedSkillNames,
} from "@/app/lib/format";
import type { SessionSummarySnapshot } from "@/app/types/api";

// The shared wire-format pin both sides test against: nac-core
// `commands.rs` reads the same file via env!("CARGO_MANIFEST_DIR").
import fixture from "../../../../../../fixtures/invoked-skills-format.json";

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
    const raw = "mentions <invoked_skills> and <skill_content in prose, uses $alpha";
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

  it("leaves prose between the separator and the closing tag unchanged", () => {
    // The collapse only fires on a well-formed appended block: a message
    // whose tail is prose survives byte-identical even though it contains
    // the separator and ends with the closing tag.
    const text = "notes\n\n<invoked_skills>\nmore prose\n</invoked_skills>";
    expect(displayPromptFromMessageText(text)).toBe(text);
  });

  it("leaves a malformed appended tail unchanged", () => {
    const cases = [
      // Extra text after the last block.
      'raw\n\n<invoked_skills>\n<skill_content name="a">\nX\n</skill_content>\nextra text\n</invoked_skills>',
      // Junk between two blocks.
      'raw\n\n<invoked_skills>\n<skill_content name="a">\nX\n</skill_content>\nJUNK\n<skill_content name="b">\nY\n</skill_content>\n</invoked_skills>',
      // A block missing its own closing tag.
      'raw\n\n<invoked_skills>\n<skill_content name="a">\nX\n</invoked_skills>',
      // An empty wrapper: real expansions always append a block.
      "raw\n\n<invoked_skills>\n\n</invoked_skills>",
      // Blocks joined by a blank line rather than a single newline.
      'raw\n\n<invoked_skills>\n<skill_content name="a">\nX\n</skill_content>\n\n<skill_content name="b">\nY\n</skill_content>\n</invoked_skills>',
    ];
    for (const text of cases) {
      expect(displayPromptFromMessageText(text)).toBe(text);
    }
  });

  it("still collapses a pasted expansion with genuine-looking blocks", () => {
    // Indistinguishable from a real expansion, so it collapses — the
    // structural check only protects prose that does not parse as blocks.
    const pasted =
      'my notes\n\n<invoked_skills>\n<skill_content name="x">\nI typed this myself\n</skill_content>\n</invoked_skills>';
    expect(displayPromptFromMessageText(pasted)).toBe("my notes");
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

describe("invokedSkillNames", () => {
  it("returns the skill names of a single-skill expansion", () => {
    const expanded = expand("Use $demo to review this change.", skillBlock("demo", "DEMO BODY"));
    expect(invokedSkillNames(expanded)).toEqual(["demo"]);
  });

  it("returns every skill of a multi-skill expansion in block order", () => {
    const expanded = expand(
      "first $beta, then $alpha",
      skillBlock("beta", "BETA BODY"),
      skillBlock("alpha", "ALPHA BODY"),
    );
    expect(invokedSkillNames(expanded)).toEqual(["beta", "alpha"]);
  });

  it("returns null for plain text, prose with the sentinel, and nullish", () => {
    expect(invokedSkillNames("just a prompt")).toBeNull();
    expect(invokedSkillNames("the <invoked_skills> element")).toBeNull();
    expect(invokedSkillNames("notes\n\n<invoked_skills>\nprose\n</invoked_skills>")).toBeNull();
    expect(invokedSkillNames(null)).toBeNull();
    expect(invokedSkillNames(undefined)).toBeNull();
  });

  it("returns null for a malformed tail instead of guessing", () => {
    const malformed =
      'raw\n\n<invoked_skills>\n<skill_content name="a">\nX\n</skill_content>\nextra\n</invoked_skills>';
    expect(invokedSkillNames(malformed)).toBeNull();
  });
});

describe("invoked-skills shared fixture", () => {
  it("matches the TS wire-format constants", () => {
    expect(INVOKED_SKILLS_SEPARATOR).toBe(fixture.separator);
    expect(INVOKED_SKILLS_OPEN).toBe(fixture.open);
    expect(INVOKED_SKILLS_CLOSE).toBe(fixture.close);
  });

  it("pins at least one collapse vector", () => {
    expect(fixture.collapse_vectors.length).toBeGreaterThan(0);
  });

  for (const vector of fixture.collapse_vectors) {
    it(`collapse vector ${vector.name}`, () => {
      expect(displayPromptFromMessageText(vector.message)).toBe(vector.display);
    });
  }
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
    expect(displaySessionTitle(summaryWithPrompt(null))).toBe("session-:7890");
  });
});
