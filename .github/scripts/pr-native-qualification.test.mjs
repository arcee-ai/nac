import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("startup catalog binds exact P12 and repaired nine-file Q supplier", () => {
  const startup = JSON.parse(readFileSync("desktop/macos/ci-qualifications.json", "utf8"))["all-342-startup-macos26"];
  assert.equal(startup.source_sha, "4b7a1f3e0bf6175a77c5ebf627fe965860e99976");
  assert.equal(startup.test_source_sha, "ba266ba1b3bea331768d91fc8a0b2ee66b484d01");
  assert.deepEqual(startup.test_files, {
    "README.md": "39c0b3aec37188e18eb141ef5537711e6f60b1fd384920d47d248cfd19758ed9",
    "StartupJourneys.swift": "7b731b4c4f40f890fb62ed97652b9c6b480c4fda463770a9fe5a95b1f30eb4f8",
    "contract.py": "d159672bb8eda5d3bf4e5d462813452c83a673974749ed4f7f07b3bb9341b91b",
    "test_contract.py": "493457530363e6992941960a6de2911c65da463db7452deb17f3af24443f916d",
    "StartupAXGuard.swift": "3be7835fe8cf48164bcfae3d5e803a1423b188ba78512ccb658858486dfa4a18",
    "StartupAXReceipt.swift": "a25b94b791e2ff24cb15016b976f78cf366540d15382c01f9bce8ec585f93217",
    "AX-WITNESS-CONTRACT.md": "1041bcef5739ebc1fe146673f7460ab82448d13dbb763af93c78f9cbf53c3bf6",
    "test_ax_witness.py": "26e3fb9b290a03642e43eb07965564d2beb8013cc28d3294a6e07c946289cdc3",
    "AGENTS.md": "074ff7d390c45a739b80048cf155274607ba3db5da74183cd5e4f673286a20fe"
});
  assert.equal(startup.protocol_source_sha, "7325c48b3c9ec7036e255a6bd92f31c1a98c1607");
  assert.deepEqual(startup.scenarios, ["onboarding", "configuredLocal", "invalidConfig", "futureStore"]);
});
