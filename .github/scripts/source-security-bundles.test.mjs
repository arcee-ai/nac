import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bundledComponents, CONFIG, INPUTS, POLICY, scanSources } from "./source-security.mjs";

function fixture(t, name = "is-number", version = "7.0.0") {
  const directory = mkdtempSync(join(tmpdir(), "nac-bundled-security-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "candidate");
  const trustedRoot = join(directory, "trusted");
  for (const checkout of [root, trustedRoot]) {
    mkdirSync(join(checkout, dirname(POLICY)), { recursive: true });
    writeFileSync(join(checkout, POLICY), JSON.stringify({ schema_version: 1, exceptions: [] }));
    writeFileSync(join(checkout, CONFIG), "# No broad suppression\n");
  }
  for (const input of INPUTS) {
    mkdirSync(join(root, dirname(input)), { recursive: true });
    const filename = input === INPUTS[0] ? "Cargo.lock" : "package-lock.json";
    copyFileSync(
      fileURLToPath(new URL(`./fixtures/security/safe/${filename}`, import.meta.url)),
      join(root, input),
    );
  }
  const lock = {
    name: "bundle-fixture",
    lockfileVersion: 3,
    packages: {
      "": { name: "bundle-fixture", version: "1.0.0" },
      "node_modules/@tailwindcss/oxide-wasm32-wasi": {
        version: "4.3.3",
        resolved:
          "https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.3.tgz",
        integrity: "sha512-fixture-only-not-installed",
        bundleDependencies: [name],
        dev: true,
      },
      [`node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/${name}`]: {
        version,
        inBundle: true,
        dev: true,
      },
    },
  };
  const inputPath = join(root, INPUTS[1]);
  const save = () => writeFileSync(inputPath, JSON.stringify(lock));
  save();
  return {
    root,
    trustedRoot,
    output: join(directory, "reports"),
    scanner: process.env.OSV_SCANNER && resolve(process.env.OSV_SCANNER),
    lock,
    inputPath,
    save,
    inventory: [
      { name, version, ecosystem: "npm", purl: `pkg:npm/${name}@${version}?source=LOCAL` },
    ],
  };
}

test("bundled identity requires exact version and registry parent/bundle evidence", (t) => {
  const w = fixture(t, "@emnapi/runtime", "1.11.1");
  assert.deepEqual(bundledComponents(w.inputPath, w.inventory), [
    {
      type: "library",
      name: "@emnapi/runtime",
      version: "1.11.1",
      purl: "pkg:npm/%40emnapi/runtime@1.11.1",
    },
  ]);
  assert.throws(
    () => bundledComponents(w.inputPath, [{ ...w.inventory[0], version: "0.0.1" }]),
    /no locked registry bundle proof/u,
  );
  delete w.lock.packages["node_modules/@tailwindcss/oxide-wasm32-wasi"].bundleDependencies;
  w.save();
  assert.throws(
    () => bundledComponents(w.inputPath, w.inventory),
    /no locked registry bundle proof/u,
  );
});

for (const origin of ["https://untrusted.example/bundle.tgz", "file:local-bundle"]) {
  test(`unsupported bundle origin fails closed: ${origin}`, (t) => {
    const w = fixture(t);
    w.lock.packages["node_modules/@tailwindcss/oxide-wasm32-wasi"].resolved = origin;
    w.save();
    assert.throws(
      () => bundledComponents(w.inputPath, w.inventory),
      /no locked registry bundle proof/u,
    );
  });
}

test(
  "real OSV queries bundled safe/vulnerable npm children, rejects unproven LOCAL records",
  {
    skip:
      !process.env.OSV_SCANNER &&
      "requires verified pinned OSV_SCANNER for live bundled fixture qualification",
  },
  (t) => {
    const safe = fixture(t);
    const clean = scanSources(safe);
    assert.equal(clean.passed, true, JSON.stringify(clean));
    assert.equal(clean.inputs[1].supplemental_packages, 1);
    assert.equal(
      JSON.parse(readFileSync(join(safe.output, "osv-bundled-1.json"))).results[0].source.type,
      "sbom",
    );
    const vulnerable = fixture(t, "handlebars", "4.7.9");
    const failed = scanSources(vulnerable);
    assert.equal(failed.passed, false);
    assert.deepEqual(failed.errors, []);
    assert.ok(
      failed.blocking.some(
        (finding) => finding.package === "npm:handlebars" && finding.context === INPUTS[1],
      ),
    );
    assert.equal(failed.inputs[1].supplemental_packages, 1);
    const unproven = fixture(t);
    delete unproven.lock.packages[
      "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/is-number"
    ].inBundle;
    unproven.save();
    assert.match(scanSources(unproven).errors.join(), /no locked registry bundle proof/u);
  },
);
