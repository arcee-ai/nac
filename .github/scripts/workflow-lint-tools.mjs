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
            `https://github.com/${pin.repository}/releases/download/v${pin.version}/${filename}`,
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
