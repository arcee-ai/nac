import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SHA = "b".repeat(40);
const TAG = "v0.1.2-rc.10";
const ASSET =
  process.platform === "darwin" && process.arch === "arm64"
    ? "nac-aarch64-apple-darwin.tar.gz"
    : "nac-x86_64-unknown-linux-musl.tar.gz";
const binary = process.env.NAC_WEB_BINARY;
if (!binary) throw new Error("NAC_WEB_BINARY must point to the built nac-web executable");

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nac-upgrade-cli-"));
  const archiveRoot = join(root, "archive");
  const installDir = join(root, "install");
  await mkdir(archiveRoot, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await writeFile(join(archiveRoot, "nac-web"), "#!/bin/sh\necho installed-rc\n", { mode: 0o755 });
  await writeFile(join(archiveRoot, "LICENSE"), "fixture license\n");
  const archive = join(root, ASSET);
  const tar = spawnSync("tar", ["-czf", archive, "-C", archiveRoot, "nac-web", "LICENSE"], {
    encoding: "utf8",
  });
  if (tar.status !== 0) throw new Error(tar.stderr);
  const archiveBytes = await readFile(archive);
  const installScript = await readFile("scripts/install.sh", "utf8");
  const requests = [];
  let active = true;

  const server = createServer((request, response) => {
    const path = request.url;
    requests.push(path);
    if (path === "/repos/test/repo/releases?per_page=100&page=1") {
      const releases = [
        { tag_name: "v0.1.1", draft: false, prerelease: false, assets: [] },
        ...(active
          ? [
              {
                tag_name: TAG,
                draft: false,
                prerelease: true,
                assets: [{ name: ASSET }],
              },
            ]
          : []),
      ];
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(releases));
    } else if (path === `/repos/test/repo/git/ref/tags/${TAG}`) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ object: { type: "commit", sha: SHA } }));
    } else if (path === `/raw/test/repo/${TAG}/scripts/uninstall.sh`) {
      response.end("#!/bin/sh\nset -eu\nrm -f \"$INSTALL_DIR/nac-web\"\n");
    } else if (path === `/raw/test/repo/${TAG}/scripts/install.sh`) {
      response.end(installScript);
    } else if (path === `/web/test/repo/releases/download/${TAG}/${ASSET}`) {
      response.setHeader("Content-Type", "application/gzip");
      response.end(archiveBytes);
    } else {
      response.statusCode = 404;
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = {
    NAC_REPO: "test/repo",
    NAC_GITHUB_API_BASE_URL: base,
    NAC_RAW_GITHUB_BASE_URL: `${base}/raw`,
    NAC_RELEASE_BASE_URL: `${base}/web`,
  };
  return {
    root,
    installDir,
    requests,
    env,
    setActive(value) {
      active = value;
    },
    reset() {
      requests.length = 0;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("CLI resolves before consent, never falls back, and installs only the exact approved RC", async () => {
  const server = await fixture();
  try {
    const nonTty = await run(
      ["upgrade", "--pre-release", "--install-dir", server.installDir],
      server.env,
    );
    assert.notEqual(nonTty.code, 0);
    assert.match(nonTty.stderr, /WARNING: prerelease upgrade requested/);
    assert.match(nonTty.stderr, /automation must pass --yes/);
    assert.equal(server.requests.some((path) => path.includes("/scripts/")), false);

    server.reset();
    const approved = await run(
      ["upgrade", "--pre-release", "--yes", "--install-dir", server.installDir],
      server.env,
    );
    assert.equal(approved.code, 0, approved.stderr);
    assert.match(approved.stderr, /WARNING: prerelease upgrade requested/);
    assert.match(approved.stderr, new RegExp(TAG.replaceAll(".", "\\.")));
    assert.deepEqual(
      server.requests.filter((path) => path.includes("/scripts/")).sort(),
      [
        `/raw/test/repo/${TAG}/scripts/install.sh`,
        `/raw/test/repo/${TAG}/scripts/uninstall.sh`,
      ],
    );
    assert.equal(
      server.requests.includes(`/web/test/repo/releases/download/${TAG}/${ASSET}`),
      true,
    );
    assert.equal(server.requests.some((path) => path.includes("/releases/latest")), false);
    assert.match(await readFile(join(server.installDir, "nac-web"), "utf8"), /installed-rc/);

    server.reset();
    server.setActive(false);
    const absent = await run(
      ["upgrade", "--pre-release", "--yes", "--install-dir", server.installDir],
      server.env,
    );
    assert.notEqual(absent.code, 0);
    assert.match(absent.stderr, /no active prerelease is available/);
    assert.equal(server.requests.some((path) => path.includes("/scripts/")), false);
    assert.equal(server.requests.some((path) => path.includes("/releases/latest")), false);
  } finally {
    await server.close();
  }
});
