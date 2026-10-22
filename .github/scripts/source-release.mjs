import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Release Please normally rediscovers all pending releases when publishing.
// Keep its existing release/label behavior, but publish only a validated plan
// bound to the one immutable merge candidate scanned by the prerequisite job.
export async function publishScannedRelease(manifest, { sha, prNumber, version }, github) {
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
  // A recovered older plan must not replace a newer stable release as Latest.
  // Inspect all published versions: API creation order is not version order.
  const scanned = version.split(".").map(BigInt);
  let exactPublished = false;
  let newerTag;
  for await (const release of github.releaseIterator()) {
    const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(release.tagName || "");
    if (release.draft && release.tagName === `v${version}`)
      throw new Error("cannot resume an unpublished draft release");
    if (release.draft || !stable) continue;
    const published = stable.slice(1).map(BigInt);
    const difference = scanned.findIndex((part, index) => part !== published[index]);
    // A retry may need Release Please's duplicate handler to finish labeling
    // this exact already-created release after a comment/label API failure.
    if (difference === -1 && release.tagName === `v${version}` && release.sha === sha) {
      exactPublished = true;
    } else if (difference === -1) {
      throw new Error(`scanned version ${version} is not newer than published ${release.tagName}`);
    } else if (scanned[difference] < published[difference]) {
      newerTag = release.tagName;
    }
  }
  if (exactPublished) {
    // Preserve the pinned library's duplicate-label handling without issuing a
    // create-release request, even if a newer release has shipped since then.
    const { DuplicateReleaseError } = createRequire(import.meta.url)(
      "release-please/build/src/errors",
    );
    const recovery = Object.create(manifest);
    recovery.createRelease = async (release) => {
      if (release !== candidate || release.sha !== sha || release.tag.toString() !== `v${version}`)
        throw new Error("duplicate recovery differs from the scanned candidate");
      throw new DuplicateReleaseError(
        Object.assign(new Error("verified release already exists"), { status: 422 }),
        `v${version}`,
      );
    };
    return recovery.createReleasesForPullRequest([candidate], candidate.pullRequest);
  }
  if (newerTag) {
    throw new Error(`scanned version ${version} is not newer than published ${newerTag}`);
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
  await publishScannedRelease(
    manifest,
    {
      sha: process.env.SCANNED_SHA,
      prNumber: Number(process.env.RELEASE_PR_NUMBER),
      version: readFileSync("version.txt", "utf8").trim(),
    },
    github,
  );
}
