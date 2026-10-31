import copy
import json
import unittest

import generate


class GuideGeneration(unittest.TestCase):
    def test_deterministic_sources_and_version(self):
        self.assertEqual(generate.generate(), generate.generate())
        pack = json.loads(generate.generate())
        self.assertEqual(pack["product_version"], (generate.ROOT / "version.txt").read_text().strip())
        self.assertEqual(len(pack["fingerprint"]), 64)
        self.assertIn("mcp", [doc["document_id"] for doc in pack["documents"]])

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
