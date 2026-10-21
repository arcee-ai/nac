import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFindings, validatePolicy } from "./security-policy.mjs";

export const INPUTS = [
  "Cargo.lock",
  "crates/nac-server/web/package-lock.json",
  ".github/scripts/package-lock.json",
];
export const POLICY = ".github/security/exceptions.json";
export const CONFIG = ".github/security/osv-scanner.toml";

function file(root, path) {
  const full = resolve(root, path);
  const rel = relative(realpathSync(root), realpathSync(full));
  if (!lstatSync(full).isFile() || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`expected a regular file within checkout: ${path}`);
  }
  return full;
}

export function loadTrustedPolicy(root, trustedRoot, options) {
  // Neither PR-authored policy additions nor deletions can self-clear a finding.
  const trusted = validatePolicy(
    JSON.parse(readFileSync(file(trustedRoot, POLICY), "utf8")),
    options,
  );
  const candidate = validatePolicy(JSON.parse(readFileSync(file(root, POLICY), "utf8")), options);
  if (JSON.stringify(candidate) !== JSON.stringify(trusted)) {
    throw new Error(
      "candidate exception policy differs from trusted base; land separately reviewed policy, then rerun",
    );
  }
  for (const checkout of [root, trustedRoot]) {
    const config = readFileSync(file(checkout, CONFIG), "utf8");
    if (config.split("\n").some((line) => line.replace(/#.*$/u, "").trim())) {
      throw new Error(
        "OSV configuration must contain only comments; use exact reviewed exceptions",
      );
    }
  }
  return trusted;
}

export function parseResults(document, context, inputPath, sourceType = "lockfile") {
  if (
    !document ||
    !Array.isArray(document.results) ||
    document.results.length !== 1 ||
    (document.errors && document.errors.length)
  )
    throw new Error(`invalid/incomplete OSV report for ${context}`);
  const source = document.results[0];
  if (
    source.source?.type !== sourceType ||
    resolve(source.source.path) !== resolve(inputPath) ||
    !Array.isArray(source.packages) ||
    !source.packages.length
  ) {
    throw new Error(`OSV report does not cover required lockfile: ${context}`);
  }
  const findings = [];
  for (const entry of source.packages) {
    const pkg = entry.package;
    const ecosystem = context === "Cargo.lock" ? "crates.io" : "npm";
    if (
      !pkg?.name ||
      !pkg.version ||
      typeof pkg.purl !== "string" ||
      pkg.ecosystem !== ecosystem ||
      (entry.vulnerabilities !== undefined && !Array.isArray(entry.vulnerabilities))
    ) {
      throw new Error(`invalid OSV package record for ${context}`);
    }
    for (const vulnerability of entry.vulnerabilities || []) {
      if (!vulnerability.id || !Array.isArray(vulnerability.affected))
        throw new Error("invalid OSV advisory");
      const fixes = vulnerability.affected
        .filter(
          (affected) =>
            affected.package?.name === pkg.name && affected.package?.ecosystem === ecosystem,
        )
        .flatMap((affected) => affected.ranges || [])
        .flatMap((range) => range.events || [])
        .map((event) => event.fixed)
        .filter(Boolean);
      findings.push({
        advisory: vulnerability.id,
        package: `${ecosystem}:${pkg.name}`,
        context,
        version: pkg.version,
        fixed: [...new Set(fixes)],
        summary: vulnerability.summary || "",
        aliases: vulnerability.aliases || [],
      });
    }
  }
  return {
    findings,
    packages: source.packages.length,
    inventory: source.packages.map((entry) => entry.package),
  };
}

function localPackages(inventory) {
  return inventory.filter((pkg) => {
    const source = new URLSearchParams(pkg.purl.split("?")[1]).get("source");
    if (source && !["LOCAL", "PUBLIC_REGISTRY"].includes(source))
      throw new Error(`unsupported package origin: ${pkg.purl}`);
    return source === "LOCAL";
  });
}

export function bundledComponents(inputPath, inventory) {
  const lock = JSON.parse(readFileSync(inputPath, "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages)
    throw new Error("expected npm v3 package inventory");
  return inventory.map((pkg) => {
    const matches = Object.entries(lock.packages).filter(
      ([path, entry]) =>
        path.endsWith(`/node_modules/${pkg.name}`) &&
        entry.version === pkg.version &&
        entry.inBundle === true &&
        !entry.resolved,
    );
    const proven = matches.some(([path]) => {
      const parent = lock.packages[path.slice(0, path.lastIndexOf("/node_modules/"))];
      if (
        !parent?.resolved ||
        !parent.integrity ||
        !Array.isArray(parent.bundleDependencies) ||
        !parent.bundleDependencies.includes(pkg.name)
      )
        return false;
      const url = new URL(parent.resolved);
      return url.protocol === "https:" && url.hostname === "registry.npmjs.org";
    });
    if (!proven)
      throw new Error(
        `unmatched LOCAL package has no locked registry bundle proof: ${pkg.name}@${pkg.version}`,
      );
    return {
      type: "library",
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${pkg.name.split("/").map(encodeURIComponent).join("/")}@${encodeURIComponent(pkg.version)}`,
    };
  });
}

function run(scanner, args) {
  const result = spawnSync(scanner, args, {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.signal)
    throw new Error(`scanner infrastructure failure: ${result.error?.message || result.signal}`);
  return result;
}

function scanInput(scanner, inputPath, configPath, rawPath, context, sourceType = "lockfile") {
  rmSync(rawPath, { force: true });
  const result = run(scanner, [
    "scan",
    "source",
    "--lockfile",
    inputPath,
    "--config",
    configPath,
    "--all-packages",
    "--all-vulns",
    "--no-call-analysis=go,rust",
    "--verbosity=error",
    "--format=json",
    "--output-file",
    rawPath,
  ]);
  writeFileSync(rawPath.replace(/\.json$/u, ".log"), result.stdout + result.stderr);
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`OSV failed (${result.status}): ${context}`);
  // Findings can take precedence over logged errors in OSV's exit-code handling.
  if ((result.stderr + result.stdout).trim())
    throw new Error(`OSV emitted error diagnostics: ${context}`);
  const parsed = parseResults(
    JSON.parse(readFileSync(rawPath, "utf8")),
    context,
    inputPath,
    sourceType,
  );
  if ((result.status === 1) !== parsed.findings.length > 0)
    throw new Error(`OSV status/report mismatch: ${context}`);
  return parsed;
}

export function scanSources({ root, trustedRoot, output, scanner, now }) {
  mkdirSync(output, { recursive: true });
  const report = {
    scanner: "OSV-Scanner 2.7.0",
    scanned_at: new Date(now || Date.now()).toISOString(),
    inputs: [],
    blocking: [],
    excepted: [],
    errors: [],
  };
  try {
    const policy = loadTrustedPolicy(root, trustedRoot, { now });
    const version = run(scanner, ["--version"]);
    if (version.status !== 0 || !/^osv-scanner version: 2\.7\.0$/mu.test(version.stdout)) {
      throw new Error("expected pinned OSV-Scanner 2.7.0");
    }
    for (const [index, context] of INPUTS.entries()) {
      try {
        const inputPath = file(root, context);
        const rawPath = resolve(output, `osv-${index}.json`);
        const configPath = file(trustedRoot, CONFIG);
        const parsed = scanInput(scanner, inputPath, configPath, rawPath, context);
        const unmatched = localPackages(parsed.inventory);
        if (unmatched.length) {
          if (context === INPUTS[0]) throw new Error("unsupported LOCAL Rust packages");
          const components = bundledComponents(inputPath, unmatched);
          const sbomPath = resolve(output, `bundled-${index}.cdx.json`);
          writeFileSync(
            sbomPath,
            JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, components }),
          );
          const supplement = scanInput(
            scanner,
            sbomPath,
            configPath,
            resolve(output, `osv-bundled-${index}.json`),
            context,
            "sbom",
          );
          const key = (pkg) => `${pkg.name}@${pkg.version}`;
          if (
            localPackages(supplement.inventory).length ||
            supplement.inventory.map(key).sort().join() !== unmatched.map(key).sort().join()
          ) {
            throw new Error("bundled supplemental inventory does not match the locked packages");
          }
          parsed.findings.push(...supplement.findings);
        }
        const evaluated = evaluateFindings(parsed.findings, policy, { now });
        report.inputs.push({
          context,
          packages: parsed.packages,
          supplemental_packages: unmatched.length,
          sha256: createHash("sha256").update(readFileSync(inputPath)).digest("hex"),
        });
        report.blocking.push(...evaluated.blocking);
        report.excepted.push(...evaluated.excepted);
      } catch (error) {
        report.errors.push(`${context}: ${error.message}`);
      }
    }
  } catch (error) {
    report.errors.push(error.message);
  }
  report.passed =
    report.errors.length === 0 &&
    report.inputs.length === INPUTS.length &&
    report.blocking.length === 0;
  writeFileSync(resolve(output, "source-security.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(resolve(output, "source-security.md"), markdown(report));
  return report;
}

function cell(value) {
  return String(value).replace(/[|\n\r<>]/gu, " ");
}
export function markdown(report) {
  const lines = [
    `## Source dependency security: ${report.passed ? "PASS" : "FAIL"}`,
    "",
    `${report.scanner}; ${report.scanned_at}. ${report.inputs.length}/${INPUTS.length} locked inputs; ${report.blocking.length} blocking matches; ${report.excepted.length} reviewed exceptions.`,
    "",
    ...report.errors.map((error) => `- ERROR: ${cell(error)}`),
    "",
    "| Input | Package | Advisory | Affected version | Fixed versions | Status |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const [status, findings] of [
    ["BLOCK", report.blocking],
    ["EXCEPTED", report.excepted],
  ]) {
    for (const finding of findings)
      lines.push(
        `| ${[
          finding.context,
          finding.package,
          finding.advisory,
          finding.version,
          finding.fixed.join(", ") || "none reported",
          status,
        ]
          .map(cell)
          .join(" | ")} |`,
      );
  }
  lines.push(
    "",
    "Upgrade the affected lockfile through its normal validation lane. Exceptions require a separate reviewed policy landing with exact advisory/package/context, reason, owner, remediation issue, and expiry; then rerun the candidate. No dev, no-fix, or package-wide exclusions apply.",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4)
      throw new Error(
        "usage: source-security.mjs CANDIDATE_ROOT TRUSTED_POLICY_ROOT REPORT_DIRECTORY SCANNER_BINARY",
      );
    const [root, trustedRoot, output, scanner] = args.map((path) => resolve(path));
    const report = scanSources({ root, trustedRoot, output, scanner });
    console.log(markdown(report));
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
