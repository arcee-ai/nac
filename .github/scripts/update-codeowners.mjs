import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { owners, codeowners } from "./pr-ruleset.mjs";

export function ownerArtifacts(workflow) {
  if (!owners.length) throw new Error("Owner roster must not be empty");
  const logins = new Set();
  const ids = new Set();
  for (const { login, id } of owners) {
    if (
      typeof login !== "string" ||
      !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login) ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      logins.has(login.toLowerCase()) ||
      ids.has(id)
    ) {
      throw new Error(
        "Owner roster requires unique GitHub logins and positive immutable account IDs",
      );
    }
    logins.add(login.toLowerCase());
    ids.add(id);
  }
  const pattern = /^            const owners = \[[\s\S]*?^            \];/gm;
  if ([...workflow.matchAll(pattern)].length !== 1) {
    throw new Error("Reviewer workflow must contain exactly one embedded owner roster");
  }
  const embedded = [
    "            const owners = [",
    ...owners.map(
      ({ login, id }) => "              { login: " + JSON.stringify(login) + ", id: " + id + " },",
    ),
    "            ];",
  ].join("\n");
  return new Map([
    [".github/CODEOWNERS", codeowners],
    [".github/workflows/pr-reviewers.yml", workflow.replace(pattern, embedded)],
  ]);
}

function run() {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !["--write", "--check"].includes(command)) {
    throw new Error("usage: update-codeowners.mjs --write | --check");
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/pr-reviewers.yml"), "utf8");
  const stale = [];
  for (const [relative, expected] of ownerArtifacts(workflow)) {
    const target = path.join(root, relative);
    if (fs.readFileSync(target, "utf8") === expected) continue;
    if (command === "--write") fs.writeFileSync(target, expected);
    else stale.push(relative);
  }
  if (stale.length) {
    throw new Error(stale.join(", ") + " is stale; run make generate-codeowners");
  }
  console.log(
    command === "--write" ? "Generated code-owner metadata" : "Code-owner metadata is current",
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run();
}
