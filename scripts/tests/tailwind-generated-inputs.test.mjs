import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Keep these fixture literals outside the production web scan root. The
// compiler/scanner must see them only in the disposable generated-file cases.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repository, "crates/nac-server/web");
const webRequire = createRequire(path.join(web, "package.json"));
const { compile } = webRequire("@tailwindcss/node");
const { Scanner } = webRequire("@tailwindcss/oxide");
const tailwindCss = webRequire.resolve("tailwindcss/index.css");
const stylesheetPath = "src/index.css";
const configurationPath = "tailwind.config.js";
const authoredPath = "src/app/atoms/project-button/index.tsx";
const generatedPath = "packages/nac-presentation/dist/index.js";
const exclusion = '@source not "../packages/nac-presentation/dist";';
const generatedOnly = ["group-hover:flex", "group-has-[:focus-visible]:flex"];
const authoredControls = [
  "sr-only",
  "group-hover:not-sr-only",
  "group-has-[:focus-visible]:not-sr-only",
  "focus-within:not-sr-only",
];
const generatedVariants = [
  `export const presentation = "${generatedOnly.join(" ")} bg-[#123456]";\n`,
  'export const presentation = "grid-cols-[17] h-[93px]";\n',
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function cssInputs(relative, inputs = new Map()) {
  if (inputs.has(relative)) return inputs;
  const file = path.resolve(web, relative);
  assert.ok(file.startsWith(web + path.sep), "stylesheet imports stay in the web owner");
  const content = await readFile(file, "utf8");
  inputs.set(relative, content);
  for (const match of content.matchAll(/@import\s+(["'])([^"']+)\1[^;]*;/gu)) {
    const specifier = match[2];
    if (specifier.startsWith(".")) {
      await cssInputs(path.normalize(path.join(path.dirname(relative), specifier)), inputs);
    } else {
      assert.equal(specifier, "tailwindcss", "bind any new stylesheet module explicitly");
    }
  }
  return inputs;
}

async function write(root, relative, bytes) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function scan(root, inputs, configuration, authored, css, generated) {
  for (const [relative, bytes] of inputs) {
    await write(root, relative, relative === stylesheetPath ? css : bytes);
  }
  await write(root, configurationPath, configuration);
  await write(root, authoredPath, authored);
  await write(root, generatedPath, generated);
  await write(root, "package.json", '{"type":"module"}\n');
  const dependencies = [];
  const compiler = await compile(await readFile(path.join(root, stylesheetPath), "utf8"), {
    base: path.join(root, "src"),
    onDependency: (file) => dependencies.push(file),
    customCssResolver: async (specifier) => (specifier === "tailwindcss" ? tailwindCss : undefined),
  });
  // Match @tailwindcss/vite's source construction. Do not filter candidates or
  // manufacture a negative scanner source: it must come from the real CSS.
  const sources = (
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: root, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }]
  ).concat(compiler.sources);
  const scanner = new Scanner({ sources });
  const candidates = [...new Set(scanner.scan())].sort();
  assert.ok(dependencies.includes(path.join(root, configurationPath)), "actual config was loaded");
  assert.ok(
    scanner.files.includes(path.join(root, authoredPath)),
    "actual authored input was scanned",
  );
  for (const candidate of authoredControls) {
    assert.ok(candidates.includes(candidate), `authored control lost: ${candidate}`);
  }
  assert.ok(candidates.length > authoredControls.length, "non-vacuous complete candidate set");
  return {
    candidates,
    generatedSelected: scanner.files.includes(path.join(root, generatedPath)),
    sources: compiler.sources,
  };
}

test(
  "generated presentation bytes cannot change the real stylesheet's candidate set",
  { timeout: 15000 },
  async (t) => {
    assert.ok(
      path.relative(web, fileURLToPath(import.meta.url)).startsWith(".."),
      "fixture stays outside production web scanning",
    );
    const inputs = await cssInputs(stylesheetPath);
    const css = inputs.get(stylesheetPath);
    assert.equal(
      css.split(exclusion).length,
      2,
      "actual stylesheet has one generated-input exclusion",
    );
    const noExclusion = css.replace(exclusion + "\n", "");
    assert.notEqual(noExclusion, css);
    const configuration = await readFile(path.join(web, configurationPath), "utf8");
    const authored = await readFile(path.join(web, authoredPath), "utf8");
    for (const candidate of authoredControls) assert.ok(authored.includes(candidate));
    const bindings = Object.fromEntries([
      ...[...inputs].map(([file, bytes]) => [file, digest(bytes)]),
      [configurationPath, digest(configuration)],
      [authoredPath, digest(authored)],
      ["package-lock.json", digest(await readFile(path.join(web, "package-lock.json")))],
    ]);
    const temporary = await realpath(
      await mkdtemp(path.join(tmpdir(), "nac-tailwind-generated-inputs-")),
    );
    try {
      const excluded = [];
      const included = [];
      for (const [index, generated] of generatedVariants.entries()) {
        const positive = await scan(
          path.join(temporary, `excluded-${index}`),
          inputs,
          configuration,
          authored,
          css,
          generated,
        );
        assert.equal(positive.generatedSelected, false);
        assert.ok(
          positive.sources.some((source) => source.negated),
          "compiler parsed the negative source",
        );
        for (const candidate of generatedOnly) assert.ok(!positive.candidates.includes(candidate));
        excluded.push(positive.candidates);
        const negative = await scan(
          path.join(temporary, `included-${index}`),
          inputs,
          configuration,
          authored,
          noExclusion,
          generated,
        );
        assert.equal(
          negative.generatedSelected,
          true,
          "negative control must actually select generated JS",
        );
        included.push(negative.candidates);
      }
      assert.deepEqual(
        excluded[0],
        excluded[1],
        "entire candidate set is independent of generated bytes",
      );
      assert.notDeepEqual(
        included[0],
        included[1],
        "negative control must detect generated-input feedback",
      );
      for (const candidate of generatedOnly) assert.ok(included[0].includes(candidate));
      for (const [file, expected] of Object.entries(bindings)) {
        assert.equal(
          digest(await readFile(path.join(web, file))),
          expected,
          `production input changed: ${file}`,
        );
      }
      t.diagnostic(
        JSON.stringify({
          node: process.version,
          bindings,
          cases: 4,
          excludedCandidates: excluded[0].length,
          negativeCandidates: included.map((set) => set.length),
        }),
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
