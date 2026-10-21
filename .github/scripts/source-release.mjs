import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Release Please normally rediscovers all pending releases when publishing.
// Keep its existing release/label behavior, but publish only a validated plan
// bound to the one immutable merge candidate scanned by the prerequisite job.
export async function publishScannedRelease(manifest, { sha, prNumber, version }) {
  if (
    !/^[a-f0-9]{40}$/u.test(sha || "") ||
    !Number.isSafeInteger(prNumber) ||
    prNumber < 1 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version || "")
  ) {
    throw new Error("invalid scanned release identity");
  }
  const candidates = (await manifest.buildReleases()).filter(
    (candidate) => candidate.pullRequest?.number === prNumber,
  );
  if (candidates.length !== 1)
    throw new Error("expected exactly one pending release for the scanned PR");
  const candidate = candidates[0];
  if (
    candidate.sha !== sha ||
    candidate.pullRequest?.sha !== sha ||
    candidate.pullRequest?.number !== prNumber ||
    candidate.path !== "." ||
    candidate.tag?.toString() !== `v${version}` ||
    candidate.forceTag === true
  ) {
    throw new Error(
      "Release Please candidate differs from scanned PR/SHA/version or would force a tag",
    );
  }
  return manifest.createReleasesForPullRequest([candidate], candidate.pullRequest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const { GitHub, Manifest } = require("release-please");
  const [owner, repo, extra] = (process.env.GITHUB_REPOSITORY || "").split("/");
  if (!owner || !repo || extra || !process.env.GH_TOKEN)
    throw new Error("repository identity and release token are required");
  const github = await GitHub.create({ owner, repo, token: process.env.GH_TOKEN });
  const manifest = await Manifest.fromManifest(github, "dev");
  await publishScannedRelease(manifest, {
    sha: process.env.SCANNED_SHA,
    prNumber: Number(process.env.RELEASE_PR_NUMBER),
    version: readFileSync("version.txt", "utf8").trim(),
  });
}
