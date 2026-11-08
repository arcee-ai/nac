import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const pins = JSON.parse(
  fs.readFileSync(new URL("./workflow-lint-tools.json", import.meta.url)),
);

export function verifyArchive(bytes, expected) {
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  ) {
    throw new Error("workflow lint tool checksum mismatch");
  }
}

// Only qualified version/platform pairs use the unauthenticated binary API.
// The existing SHA256 remains the authority for both downloaded and cached bytes.
export function downloadUrl(pin, platform) {
  const asset = pin.assets[platform];
  if (!asset) throw new Error(`unsupported workflow lint platform: ${platform}`);
  const ids = pin.release_asset_ids;
  if (ids !== undefined) {
    if (!ids || Object.keys(ids).length !== 1 || !Object.hasOwn(ids, pin.version))
      throw new Error("stale workflow lint release asset mapping");
    if (!ids[pin.version] || typeof ids[pin.version] !== "object" ||
        Object.entries(ids[pin.version]).some(([host, id]) =>
          !Object.hasOwn(pin.assets, host) || !Number.isSafeInteger(id) || id <= 0))
      throw new Error("invalid release asset ID");
  }
  const id = ids?.[pin.version]?.[platform];
  if (id !== undefined) {
    return `https://api.github.com/repos/${pin.repository}/releases/assets/${id}`;
  }
  return `https://github.com/${pin.repository}/releases/download/v${pin.version}/${asset[0]}`;
}

// Cache archives, never executables. Reverify even cache hits and extract only the
// named binary into a fresh private directory on every invocation.
export function installTools(cache = path.join(os.homedir(), ".cache/nac/workflow-lint")) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nac-workflow-lint-"));
  try {
    fs.mkdirSync(cache, { recursive: true });
    const binaries = {};
    for (const [name, pin] of Object.entries(pins)) {
      const asset = pin.assets[`${process.platform}-${process.arch}`];
      if (!asset)
        throw new Error(`unsupported workflow lint platform: ${process.platform}/${process.arch}`);
      const [filename, digest, member] = asset;
      const url = downloadUrl(pin, `${process.platform}-${process.arch}`);
      const archive = path.join(cache, filename);
      if (!fs.existsSync(archive)) {
        const download = path.join(directory, filename);
        execFileSync(
          "curl",
          [
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--retry",
            "2",
            "--connect-timeout",
            "20",
            "--max-time",
            "180",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--header",
            "Accept: application/octet-stream",
            url,
            "--output",
            download,
          ],
          { stdio: "inherit" },
        );
        verifyArchive(fs.readFileSync(download), digest);
        const pending = fs.mkdtempSync(path.join(cache, ".download-"));
        try {
          fs.copyFileSync(download, path.join(pending, filename));
          fs.renameSync(path.join(pending, filename), archive);
        } finally {
          fs.rmSync(pending, { recursive: true, force: true });
        }
      }
      verifyArchive(fs.readFileSync(archive), digest);
      execFileSync("tar", ["-xzf", archive, "-C", directory, member]);
      binaries[name] = path.join(directory, member);
      fs.chmodSync(binaries[name], 0o755);
    }
    return { ...binaries, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
