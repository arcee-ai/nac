"""Pinned scanner transport controls; no scanner archive is executed."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import subprocess
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import image_scan as scan


class ToolTransportTests(unittest.TestCase):
    def test_qualified_asset_is_bound_to_original_version_platform_and_hash(self):
        pins = json.loads(scan.PINS.read_text())
        syft = pins["syft"]
        self.assertEqual(syft["version"], "1.55.0")
        self.assertEqual(syft["linux_amd64"], "bb65249542db5fedeeb4d3f9b018b75e7264dbfbbb10486f044581a92f90490d")
        self.assertEqual(syft["release_asset_ids"], {"1.55.0": {"linux_amd64": 657153873}})
        self.assertEqual(scan.tool_download_url("syft", syft, "linux_amd64"),
                         "https://api.github.com/repos/anchore/syft/releases/assets/657153873")
        self.assertEqual(scan.tool_download_url("syft", syft, "darwin_arm64"),
                         "https://github.com/anchore/syft/releases/download/v1.55.0/syft_1.55.0_darwin_arm64.tar.gz")
        self.assertEqual(scan.tool_download_url("grype", pins["grype"], "linux_amd64"),
                         "https://api.github.com/repos/anchore/grype/releases/assets/657365424")
        with self.assertRaisesRegex(ValueError, "stale"):
            scan.tool_download_url("syft", dict(syft, version="999.0.0"), "linux_amd64")
        for bad in [None, True, 0, -1, "657153873", 1.5]:
            pin = dict(syft, release_asset_ids={"1.55.0": {"linux_amd64": bad}})
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "asset ID"):
                scan.tool_download_url("syft", pin, "linux_amd64")

    def test_grype_mapping_preserves_original_pin_and_darwin_route(self):
        pin = json.loads(scan.PINS.read_text())["grype"]
        self.assertEqual(pin["version"], "0.121.0")
        self.assertEqual(pin["linux_amd64"], "64e07133d3486115de647a66581461dccf5c732748a0a3119077395565f15519")
        self.assertEqual(pin["release_asset_ids"], {"0.121.0": {"linux_amd64": 657365424}})
        self.assertEqual(scan.tool_download_url("grype", pin, "linux_amd64"),
                         "https://api.github.com/repos/anchore/grype/releases/assets/657365424")
        self.assertEqual(scan.tool_download_url("grype", pin, "darwin_arm64"),
                         "https://github.com/anchore/grype/releases/download/v0.121.0/grype_0.121.0_darwin_arm64.tar.gz")
        with self.assertRaisesRegex(ValueError, "stale"):
            scan.tool_download_url("grype", dict(pin, version="999.0.0"), "linux_amd64")
        for bad in [None, True, 0, -1, "657365424", 1.5]:
            invalid = dict(pin, release_asset_ids={"0.121.0": {"linux_amd64": bad}})
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "asset ID"):
                scan.tool_download_url("grype", invalid, "linux_amd64")

    def test_grype_route_and_cache_hash_gate_before_extraction(self):
        class VerifiedArchiveBoundary(Exception):
            pass
        payload = b"inert Grype transport fixture; never extracted"
        for mode in ["valid", "cached-valid", "failed", "corrupt", "cached-corrupt"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                pinfile = root / "pins.json"
                pins = copy.deepcopy(json.loads(scan.PINS.read_text()))
                pins["grype"]["linux_amd64"] = hashlib.sha256(payload).hexdigest()
                pinfile.write_text(json.dumps(pins))
                cache = root / "cache"
                cache.mkdir()
                archive = cache / "grype_0.121.0_linux_amd64.tar.gz"
                if mode.startswith("cached"):
                    archive.write_bytes(payload if mode == "cached-valid" else b"corrupt")
                def api(args, **kwargs):
                    self.assertEqual(args[1], scan.ROOT / ".github/scripts/github_asset.py")
                    self.assertEqual(args[args.index("--url") + 1],
                                     "https://api.github.com/repos/anchore/grype/releases/assets/657365424")
                    self.assertEqual(args[args.index("--max-bytes") + 1], str(150 * 1024 * 1024))
                    self.assertEqual(kwargs, {"check": True})
                    if mode == "failed":
                        raise subprocess.CalledProcessError(1, args)
                    Path(args[args.index("--output") + 1]).write_bytes(b"corrupt" if mode == "corrupt" else payload)
                with patch.object(scan, "PINS", pinfile), patch.object(scan.platform, "system", return_value="Linux"), patch.object(
                        scan.platform, "machine", return_value="x86_64"), patch.object(
                        scan.subprocess, "run", side_effect=api) as fetch, patch.object(
                        scan, "download", side_effect=TimeoutError("The read operation timed out")) as legacy, patch.object(
                        scan.tarfile, "open", side_effect=VerifiedArchiveBoundary) as extraction:
                    expected = (VerifiedArchiveBoundary if mode in ["valid", "cached-valid"] else
                                subprocess.CalledProcessError if mode == "failed" else ValueError)
                    with self.assertRaises(expected):
                        scan.install_tools(cache, names={"grype"})
                    self.assertEqual(fetch.call_count, 0 if mode.startswith("cached") else 1)
                    legacy.assert_not_called()
                    self.assertEqual(extraction.call_count, 1 if mode in ["valid", "cached-valid"] else 0)
                    self.assertFalse((cache / "grype").exists())

    def test_binary_request_has_no_authorization_and_retains_bound(self):
        with patch.object(scan.urllib.request, "urlopen", return_value=io.BytesIO(b"ok")) as read:
            self.assertEqual(scan.download("https://api.github.com/asset", accept="application/octet-stream"), b"ok")
            request = read.call_args.args[0]
            self.assertEqual(dict(request.header_items()), {"Content-type": "application/json", "Accept": "application/octet-stream"})
            self.assertEqual(read.call_args.kwargs, {"timeout": 120})
        with patch.object(scan.urllib.request, "urlopen", return_value=io.BytesIO(b"oversized")) as read:
            with self.assertRaisesRegex(ValueError, "size limit"):
                scan.download("https://api.github.com/asset", limit=2, accept="application/octet-stream")
            read.assert_called_once()

    def archive(self, kind=tarfile.REGTYPE):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as bundle:
            member = tarfile.TarInfo("syft")
            member.type = kind
            member.linkname = "/unrelated"
            member.size = 1 if kind == tarfile.REGTYPE else 0
            bundle.addfile(member, io.BytesIO(b"x") if member.size else None)
        return data.getvalue()

    def install(self, root, payload, response, cached=False):
        pins = copy.deepcopy(json.loads(scan.PINS.read_text()))
        pins["syft"]["linux_amd64"] = hashlib.sha256(payload).hexdigest()
        pinfile = root / "pins.json"
        pinfile.write_text(json.dumps(pins))
        cache = root / "cache"
        cache.mkdir()
        if cached:
            (cache / "syft_1.55.0_linux_amd64.tar.gz").write_bytes(response)
        def transport(url, **kwargs):
            # The original browser release route reproduces HTTP504.
            if "/releases/download/" in url:
                raise HTTPError(url, 504, "unavailable", {}, None)
            self.assertEqual(url, "https://api.github.com/repos/anchore/syft/releases/assets/657153873")
            self.assertEqual(kwargs, {"accept": "application/octet-stream"})
            if isinstance(response, Exception):
                raise response
            return response
        def api_transport(args, **kwargs):
            self.assertEqual(args[1], scan.ROOT / ".github/scripts/github_asset.py")
            url = args[args.index("--url") + 1]
            self.assertEqual(url, "https://api.github.com/repos/anchore/syft/releases/assets/657153873")
            self.assertEqual(kwargs, {"check": True})
            self.assertEqual(args[args.index("--max-bytes") + 1], str(150 * 1024 * 1024))
            if isinstance(response, Exception):
                raise subprocess.CalledProcessError(1, args)
            Path(args[args.index("--output") + 1]).write_bytes(response)
        with patch.object(scan, "PINS", pinfile), patch.object(scan.platform, "system", return_value="Linux"), patch.object(
                scan.platform, "machine", return_value="x86_64"), patch.object(scan.subprocess, "run", side_effect=api_transport) as read:
            try:
                return scan.install_tools(cache, names={"syft"})
            finally:
                self.calls = read.call_count

    def test_api_install_and_cache_revalidation_never_execute_archive(self):
        payload = self.archive()
        for cached in [False, True]:
            with self.subTest(cached=cached), tempfile.TemporaryDirectory() as d:
                tools, evidence = self.install(Path(d), payload, payload, cached=cached)
                self.assertEqual(tools["syft"].read_bytes(), b"x")
                self.assertEqual(evidence["syft"]["archive_sha256"], hashlib.sha256(payload).hexdigest())
                self.assertEqual(self.calls, 0 if cached else 1)

    def test_http_errors_corrupt_response_and_cache_do_not_fall_back_or_expose_binary(self):
        payload = self.archive()
        cases = [(False, HTTPError("api", code, "failed", {}, None)) for code in [403, 404, 429, 504]]
        cases += [(False, b"corrupt"), (True, b"corrupt")]
        for cached, response in cases:
            with self.subTest(cached=cached, response=response), tempfile.TemporaryDirectory() as d:
                with self.assertRaises((ValueError, OSError, subprocess.CalledProcessError)):
                    self.install(Path(d), payload, response, cached=cached)
                self.assertEqual(self.calls, 0 if cached else 1)
                self.assertFalse((Path(d) / "cache/syft").exists())
                if isinstance(response, HTTPError):
                    response.close()

    def test_hash_verified_unsafe_member_is_still_rejected(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE]:
            payload = self.archive(kind)
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as d:
                with self.assertRaisesRegex(ValueError, "not a regular file"):
                    self.install(Path(d), payload, payload)
                self.assertFalse((Path(d) / "cache/syft").exists())

    def test_unsupported_host_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as d, patch.object(scan.platform, "system", return_value="Unknown"), patch.object(
                scan, "download") as read:
            with self.assertRaisesRegex(ValueError, "unsupported scanner host"):
                scan.install_tools(Path(d), names={"syft"})
            read.assert_not_called()
