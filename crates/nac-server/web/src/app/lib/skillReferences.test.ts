import { describe, expect, it } from "vitest";

import { skillReferenceQuery, skillReferenceSegments } from "@/app/lib/skillReferences";
import type { SkillCatalogEntry } from "@/app/types/api";

function skill(name: string, description = `${name} description`): SkillCatalogEntry {
  return { name, description, compatibility: null };
}

describe("skillReferenceSegments", () => {
  it("uses the longest exact registered name and backend boundary", () => {
    const entries = [skill("code"), skill("code-review")];

    expect(skillReferenceSegments("run $code-review, then $code.", entries)).toEqual([
      { text: "run ", skillName: null },
      { text: "$code-review", skillName: "code-review" },
      { text: ", then ", skillName: null },
      { text: "$code", skillName: "code" },
      { text: ".", skillName: null },
    ]);
    expect(skillReferenceSegments("$codebase $code-review审查", entries)).toEqual([
      { text: "$codebase $code-review审查", skillName: null },
    ]);
  });

  it("matches punctuation, Unicode, spaces, and dollar signs literally", () => {
    const entries = [skill("code.review"), skill("技能"), skill("foo bar"), skill("cash$flow")];
    const value = "$code.review / $技能 / $foo bar / $cash$flow";

    expect(
      skillReferenceSegments(value, entries)
        .filter((segment) => segment.skillName)
        .map((segment) => segment.skillName),
    ).toEqual(["code.review", "技能", "foo bar", "cash$flow"]);
  });

  it("leaves unknown dollar syntax and partial names ordinary", () => {
    const entries = [skill("demo")];
    const value = "$HOME costs $5; partial $dem and repeated $$demo";

    expect(skillReferenceSegments(value, entries)).toEqual([
      { text: "$HOME costs $5; partial $dem and repeated $", skillName: null },
      { text: "$demo", skillName: "demo" },
    ]);
  });
});

describe("skillReferenceQuery", () => {
  const entries = [skill("CodeReview"), skill("cash$flow"), skill("foo bar")];

  it("lists every skill from a bare marker and filters without case sensitivity", () => {
    expect(skillReferenceQuery("$", 1, 1, entries)?.entries).toEqual(entries);
    expect(skillReferenceQuery("ask $code", 9, 9, entries)?.entries).toEqual([entries[0]]);
  });

  it("chooses the earliest matching marker when a skill name contains dollar signs", () => {
    const value = "use $cash$fl";
    const query = skillReferenceQuery(value, value.length, value.length, entries);

    expect(query).toMatchObject({ start: 4, end: value.length });
    expect(query?.entries.map((entry) => entry.name)).toEqual(["cash$flow"]);
  });

  it("supports spaces and an interior caret before punctuation", () => {
    const value = "use $foo b, later";
    const caret = value.indexOf(",");

    expect(skillReferenceQuery(value, caret, caret, entries)).toMatchObject({
      start: 4,
      end: caret,
    });
  });

  it("suppresses completion when the preserved suffix would invalidate the reference", () => {
    expect(skillReferenceQuery("$CodeX", 5, 5, entries)).toBeNull();
    expect(skillReferenceQuery("$Code-x", 5, 5, entries)).toBeNull();
    expect(skillReferenceQuery("$Code,", 5, 5, entries)).not.toBeNull();
  });

  it("closes for selections, unknown prefixes, and empty catalogs", () => {
    expect(skillReferenceQuery("$Code", 1, 5, entries)).toBeNull();
    expect(skillReferenceQuery("$unknown", 8, 8, entries)).toBeNull();
    expect(skillReferenceQuery("$", 1, 1, [])).toBeNull();
    expect(skillReferenceQuery("$Code", 0, 0, entries)).toBeNull();
  });
});
