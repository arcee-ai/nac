// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { minimatch } from "minimatch";
import ts from "typescript";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(web, "../../..");
const artifacts = "crates/nac-server/web/test-results";

function qualificationProjection() {
  const file = path.join(web, "e2e/fresh-interval-tasks.e2e.ts");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const expressions: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === "qualification" &&
      ts.isObjectLiteralExpression(node.right)
    ) {
      expressions.push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(expressions).toHaveLength(1);
  // Compile only the actual projection, never the E2E module, imports, callbacks,
  // harness or provider. All free inputs below are inert source-shaped objects.
  const { outputText } = ts.transpileModule(
    `function project() { return ${expressions[0].getText(source)}; }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  );
  return (inputs: ReturnType<typeof qualificationInputs>) => {
    const evaluate = new Function(...Object.keys(inputs), outputText + "\nreturn project();");
    return JSON.parse(JSON.stringify(evaluate(...Object.values(inputs)))) as {
      creator_session_id: string | null;
      creator_run_id: string | null;
      logical_runs: number;
      function_calls: number;
      tasks: Array<Record<string, unknown> & { initial_run_id: string }>;
      continuations: Array<{ session_id: string; run_id: string; proof_file: string }>;
    };
  };
}

const acceptedCreator = {
  status: 202,
  run_id: "native-accepted-creator-run",
  display_prompt: "PRIVATE_PROMPT_SENTINEL",
  headers: { authorization: "PRIVATE_HEADER_SENTINEL" },
  body: "PRIVATE_BODY_SENTINEL",
};
const expectedRunIds = [
  "human-initial-one",
  "human-initial-two",
  "human-continued-one",
  "human-continued-two",
  "model-native-initial-one",
  "model-native-initial-two",
  "model-native-continued-one",
  "model-native-continued-two",
  "native-accepted-creator-run",
];

function qualificationInputs(lane: "human" | "model-native") {
  const task = (ordinal: string) => ({
    receipt: {
      occurrence_id: `${lane}-occurrence-${ordinal}`,
      session_id: `${lane}-session-${ordinal}`,
      initial_run_id: `${lane}-initial-${ordinal}`,
      first_input_id: `${lane}-input-${ordinal}`,
      initial_outcome: { outcome: "unchanged", settlement_sequence: 7 },
      display_prompt: acceptedCreator.display_prompt,
      headers: acceptedCreator.headers,
      environment: "PRIVATE_ENV_SENTINEL",
      database: "PRIVATE_DB_SENTINEL",
      trace: "PRIVATE_TRACE_SENTINEL",
      body: acceptedCreator.body,
    },
    occurrence: { due_first_ms: 60000, run_now: false },
    launch: { workspace_path: "PRIVATE_PATH_SENTINEL" },
  });
  const continuations = ["one", "two"].map((ordinal) => ({
    session_id: `${lane}-session-${ordinal}`,
    run_id: `${lane}-continued-${ordinal}`,
    proof_file: `${ordinal}.txt`,
  }));
  const first = task("one");
  const second = task("two");
  const creatorRun = lane === "human" ? undefined : acceptedCreator.run_id;
  return {
    lane,
    started: 1000,
    Date: { now: () => 121000 },
    schedule: { schedule_id: `${lane}-schedule` },
    f: { commit: "fixture-source-commit" },
    creatorSession: lane === "human" ? undefined : "native-creator-session",
    creatorRun,
    accepted: acceptedCreator,
    runs: [
      first.receipt.initial_run_id,
      second.receipt.initial_run_id,
      ...continuations.map((item) => item.run_id),
      ...(creatorRun ? [creatorRun] : []),
    ],
    functionCalls: Array.from({ length: lane === "human" ? 6 : 8 }, (_, index) => ({
      path: "/responses",
      matchedStep: `${lane}-function-${index}`,
    })),
    continuations,
    first,
    second,
  };
}

function assertRunLedger(
  project: ReturnType<typeof qualificationProjection>,
  nativeInputs = qualificationInputs("model-native"),
) {
  const human = project(qualificationInputs("human"));
  const native = project(nativeInputs);
  const ids = [human, native].flatMap((item) => [
    ...item.tasks.map((task) => task.initial_run_id),
    ...item.continuations.map((run) => run.run_id),
    ...(item.creator_run_id ? [item.creator_run_id] : []),
  ]);
  expect(ids.toSorted()).toEqual(expectedRunIds.toSorted());
  expect(new Set(ids).size).toBe(9);
  expect(acceptedCreator.status).toBe(202);
  expect(native.creator_run_id).toBe(acceptedCreator.run_id);
  expect(native.creator_session_id).toBe("native-creator-session");
  expect(human.creator_session_id).toBeNull();
  expect(human.creator_run_id).toBeNull();
  expect([human.logical_runs, native.logical_runs]).toEqual([4, 5]);
  expect([human.function_calls, native.function_calls]).toEqual([6, 8]);
  return [human, native];
}

test("actual elapsed qualification exports all nine exact run IDs and only allowed receipt fields", () => {
  const records = assertRunLedger(qualificationProjection());
  for (const record of records) {
    expect(Object.keys(record).sort()).toEqual([
      "continuations",
      "creator_run_id",
      "creator_session_id",
      "finished_at_ms",
      "function_calls",
      "lane",
      "logical_runs",
      "schedule_id",
      "source_commit",
      "source_preserved",
      "started_at_ms",
      "status",
      "tasks",
    ]);
    expect(record.tasks).toHaveLength(2);
    expect(record.continuations).toHaveLength(2);
    for (const continuation of record.continuations) {
      expect(Object.keys(continuation).sort()).toEqual(["proof_file", "run_id", "session_id"]);
    }
    for (const task of record.tasks) {
      expect(Object.keys(task).sort()).toEqual([
        "due_first_ms",
        "first_input_id",
        "initial_outcome",
        "initial_run_id",
        "occurrence_id",
        "run_now",
        "session_id",
        "settlement_sequence",
      ]);
    }
    const json = JSON.stringify(record);
    expect(json).not.toContain("PRIVATE_");
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(256 * 1024);
  }
});

test.each([
  ["missing creator", undefined],
  ["duplicate initial run", "model-native-initial-one"],
  ["duplicate continuation run", "model-native-continued-one"],
  ["session substituted for run", "native-creator-session"],
  ["function call substituted for run", "elapsed-native-create"],
])("actual elapsed qualification rejects an invalid ledger: %s", (_name, creatorRun) => {
  const inputs = qualificationInputs("model-native");
  inputs.creatorRun = creatorRun;
  expect(() => assertRunLedger(qualificationProjection(), inputs)).toThrow();
});

function titles(file: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const literal: string[] = [];
  const elapsed: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "test") {
      const title = node.arguments[0];
      if (title && ts.isStringLiteral(title)) literal.push(title.text);
      if (title && ts.isTemplateExpression(title) && title.head.text === "elapsed ") {
        expect(title.templateSpans).toHaveLength(1);
        expect(title.templateSpans[0].expression.getText(source)).toBe("lane");
        for (const lane of ["human", "model-native"]) {
          elapsed.push(title.head.text + lane + title.templateSpans[0].literal.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { literal, elapsed };
}

function uploadPaths(step: string) {
  const match = step.match(/ {10}path: \|\n((?: {12}.+\n)+)/);
  if (!match) throw new Error("Expected the maintained literal upload path list");
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.trim());
}

function includes(patterns: string[], file: string) {
  let included = false;
  for (const pattern of patterns) {
    const exclude = pattern.startsWith("!");
    const glob = exclude ? pattern.slice(1) : pattern;
    // The pinned uploader uses @actions/glob with implicit descendants.
    if (
      minimatch(file, glob, { dot: true }) ||
      (glob === artifacts && file.startsWith(glob + "/"))
    ) {
      included = !exclude;
    }
  }
  return included;
}

test("elapsed evidence stays bounded on success and failure while old failure artifacts remain", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/stable-release.yml"), "utf8");
  const browserShards = workflow.split("\n  browser-shards:\n")[1].split("\n  browser-proof:\n")[0];
  const selectedStep = browserShards
    .split("      - name: Upload selected elapsed interval evidence")[1]
    .split("      - name: Upload browser shard failure artifacts")[0];
  const failureStep = browserShards.split("      - name: Upload browser shard failure artifacts")[1];
  const selected = uploadPaths(selectedStep);
  const failure = uploadPaths(failureStep);
  expect(selected).toHaveLength(6);
  expect(failure).toHaveLength(2);
  expect(failure[0]).toBe(artifacts);
  expect(failureStep).toContain("if: failure()");
  expect(selectedStep).toContain("always() && hashFiles(");
  expect(selectedStep).toContain("retention-days: 3");
  for (const step of [selectedStep, failureStep]) {
    expect(step).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
  }

  // Execute only the pinned output-path getter with inert objects and its pure
  // utility exports. Never import the worker entry, harness or test callbacks.
  const playwright = path.dirname(require.resolve("playwright/package.json"));
  const worker = fs.readFileSync(path.join(playwright, "lib/worker/workerProcessEntry.js"), "utf8");
  const begin = worker.indexOf("    this.outputDir = (() => {");
  const end = worker.indexOf("    })();", begin);
  expect(begin).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(begin);
  const length = Number(worker.match(/windowsFilesystemFriendlyLength = (\d+)/)?.[1]);
  expect(length).toBeGreaterThan(0);
  const core: {
    utils: {
      sanitizeForFilePath: (value: string) => string;
      trimLongString: (value: string, length: number) => string;
    };
  } = require("playwright-core/lib/coreBundle");
  const output = new Function(
    "import_path3",
    "sanitizeForFilePath2",
    "trimLongString",
    "windowsFilesystemFriendlyLength",
    "projectInternal",
    worker.slice(begin, end + 12) + "\nreturn this.outputDir;",
  );
  const directory = (file: string, title: string, suffix = "") => {
    const value: unknown = output.call(
      {
        project: { testDir: path.join(web, "e2e"), outputDir: artifacts },
        _requireFile: path.join(web, "e2e", file),
        titlePath: [file, title],
        retry: 0,
        repeatEachIndex: 0,
      },
      { default: path },
      core.utils.sanitizeForFilePath,
      core.utils.trimLongString,
      length,
      { id: "" },
    );
    if (typeof value !== "string") throw new Error("Pinned output getter did not return a path");
    return value + suffix;
  };
  const owner = "fresh-interval-tasks.e2e.ts";
  const own = titles(path.join(web, "e2e", owner));
  const shared = "fresh-interval-shared.e2e.ts";
  const previous = [
    ...own.literal.map((title) => directory(owner, title)),
    ...titles(path.join(web, "e2e", shared)).literal.map((title) => directory(shared, title)),
  ];
  expect(previous).toHaveLength(3);
  expect(own.elapsed).toHaveLength(2);
  const raw = [
    "run/store.db",
    "trace.zip",
    "video.webm",
    "run/home/credentials",
    "run/environment.json",
    "run/page.html",
    "run/provider-requests.json",
    "run/workspace/seed",
  ];
  for (const dir of previous)
    for (const file of raw) {
      expect(includes(failure, `${dir}/${file}`)).toBe(true);
      expect(includes(selected, `${dir}/${file}`)).toBe(false);
    }
  const evidence: string[] = [];
  for (const [index, title] of own.elapsed.entries()) {
    const lane = index === 0 ? "human" : "model-native";
    const dir = directory(owner, title);
    for (const suffix of ["", "-chromium", "-retry1", "-repeat1"]) {
      for (const file of raw) expect(includes(failure, `${dir}${suffix}/${file}`)).toBe(false);
    }
    for (const file of [
      ...raw,
      "elapsed-extra.png",
      "elapsed-qualification-evil.json",
      "run/workspace/elapsed-human-two-tasks.png",
    ]) {
      expect(includes(selected, `${dir}/${file}`)).toBe(false);
    }
    for (const file of [
      `elapsed-${lane}-two-tasks.png`,
      `elapsed-${lane}-both-continued.png`,
      `elapsed-qualification-${lane}.json`,
    ]) {
      const candidate = `${dir}/${file}`;
      expect(includes(selected, candidate)).toBe(true);
      expect(includes(failure, candidate)).toBe(false);
      evidence.push(candidate);
    }
  }
  expect(evidence.filter((file) => file.endsWith(".png"))).toHaveLength(4);
  expect(evidence.filter((file) => file.endsWith(".json"))).toHaveLength(2);
  expect(4 * 2 * 1024 * 1024 + 2 * 256 * 1024).toBeLessThan(9 * 1024 * 1024);
  const source = fs.readFileSync(path.join(web, "e2e", owner), "utf8");
  expect(source).toContain("expect(png.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024)");
  expect(source).toContain("expect(Buffer.byteLength(json)).toBeLessThanOrEqual(256 * 1024)");
});
