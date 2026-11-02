import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import generate


class GuideGeneration(unittest.TestCase):
    def test_deterministic_sources_and_manifest(self):
        self.assertEqual(generate.generate(), generate.generate())
        pack = json.loads(generate.generate())
        self.assertNotIn("product_version", pack)
        self.assertEqual(len(pack["fingerprint"]), 64)
        self.assertIn("mcp", [doc["document_id"] for doc in pack["documents"]])

    def test_version_only_release_keeps_content_pack_valid(self):
        # Release Please changes version.txt without rewriting other artifacts.
        # BuildIdentity binds that installed version at compile time; source
        # generation must not create an independently stale version value.
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "topic.md").write_text("# Topic\nRelease-local knowledge.\n")
            router = root / "router.md"
            router.write_text("Use the installed guide.\n")
            sources = [dict(document_id="topic", source_path="topic.md", title="Topic", sections=[])]
            with patch.object(generate, "ROOT", root), patch.object(generate, "ROUTER", router):
                (root / "version.txt").write_text("0.1.4\n")
                before = generate.generate(sources)
                (root / "version.txt").write_text("9.8.7\n")
                self.assertEqual(before, generate.generate(sources))

    def test_ids_and_heading_drift_are_rejected(self):
        sources = json.loads(generate.SOURCES.read_text())
        duplicate = copy.deepcopy(sources)
        duplicate.append(duplicate[0])
        with self.assertRaisesRegex(ValueError, "duplicate document"):
            generate.generate(duplicate)
        drift = copy.deepcopy(sources)
        drift[0]["sections"][0]["heading"] = "Removed heading"
        with self.assertRaisesRegex(ValueError, "headings drifted"):
            generate.generate(drift)

    def test_reference_links_and_fenced_headings(self):
        path = generate.ROOT / "docs/usage/mcp.md"
        with self.assertRaisesRegex(ValueError, "missing local link"):
            generate.check_links(path, "[missing](does-not-exist.md)")
        with self.assertRaisesRegex(ValueError, "missing heading"):
            generate.check_links(path, "[missing](skills.md#removed-heading)")
        self.assertEqual(generate.headings("# Real\n```sh\n## fake\n```\n## Next\n"), [(1, "Real", 0), (2, "Next", 25)])


if __name__ == "__main__":
    unittest.main()
