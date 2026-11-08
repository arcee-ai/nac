#!/usr/bin/env python3
"""API-hop credential custody and bounded, sanitized binary transport controls."""
import contextlib
import http.client
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

import github_asset as asset

API = "https://api.github.com/repos/example/tool/releases/assets/123"
CANARY = "ghs_PRIVATE_CANARY_NEVER_LOG"
SIGNED = "https://assets.example.invalid/binary?signature=SIGNED_CANARY"


class Response(io.BytesIO):
    def __init__(self, code=200, body=b"archive", headers=None):
        super().__init__(body)
        self.code = code
        self.headers = headers or {}


class Controls(unittest.TestCase):
    def run_download(self, replies, token=CANARY, limit=100, existing=None):
        calls = []
        def open_request(request, timeout):
            calls.append((request, timeout))
            response = replies.pop(0)
            if isinstance(response, Exception):
                raise response
            return response
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / "download"
            if existing is not None:
                output.write_bytes(existing)
            stderr = io.StringIO()
            error = None
            with patch.dict(os.environ, {"GITHUB_TOKEN": token}), patch.object(
                    asset.urllib.request, "build_opener") as build, contextlib.redirect_stderr(stderr):
                build.return_value.open.side_effect = open_request
                try:
                    asset.download_asset(API, output, limit)
                except (ValueError, OSError) as failure:
                    error = failure
                self.assertIsInstance(build.call_args.args[0], asset.NoRedirect)
            data = output.read_bytes() if output.exists() else None
            return calls, data, stderr.getvalue(), error

    def assert_safe_output(self, text):
        self.assertNotIn(CANARY, text)
        self.assertNotIn("SIGNED_CANARY", text)
        self.assertNotIn("https://", text)

    def test_api200_with_or_without_existing_job_token(self):
        for token in [CANARY, ""]:
            with self.subTest(token_present=bool(token)):
                calls, data, diagnostic, error = self.run_download([Response()], token=token)
                self.assertIsNone(error)
                self.assertEqual(data, b"archive")
                request, timeout = calls[0]
                self.assertEqual(request.full_url, API)
                self.assertEqual(timeout, 60)
                self.assertEqual(request.get_header("Authorization"), "Bearer " + token if token else None)
                self.assertEqual(request.get_header("Accept"), "application/octet-stream")
                self.assert_safe_output(diagnostic)

    def test_explicit_redirect_never_forwards_token_even_back_to_api(self):
        for target in [SIGNED, API, "https://another.example.invalid/file"]:
            with self.subTest(target=target):
                calls, data, diagnostic, error = self.run_download([
                    urllib.error.HTTPError(API, 302, CANARY, {"Location": target}, io.BytesIO()), Response()])
                self.assertIsNone(error)
                self.assertEqual(data, b"archive")
                self.assertEqual(len(calls), 2)
                self.assertEqual(calls[0][0].get_header("Authorization"), "Bearer " + CANARY)
                self.assertIsNone(calls[1][0].get_header("Authorization"))
                self.assertNotIn(CANARY, str(calls[1][0].header_items()))
                self.assert_safe_output(diagnostic)
        self.assertIsNone(asset.NoRedirect().redirect_request(None, None, 302, "", {}, SIGNED))

    def test_gh_token_is_not_an_asset_authentication_fallback(self):
        with patch.dict(os.environ, {"GH_TOKEN": "ghp_SYNTHETIC_LOCAL_PAT"}):
            calls, data, diagnostic, error = self.run_download([Response()], token="")
        self.assertIsNone(error)
        self.assertEqual(data, b"archive")
        self.assertIsNone(calls[0][0].get_header("Authorization"))
        self.assertNotIn("ghp_SYNTHETIC_LOCAL_PAT", diagnostic)

    def test_http_error_response_reports_only_allowlisted_facts_without_retry(self):
        for code in [403, 404, 429, 504]:
            response = urllib.error.HTTPError(API, code, CANARY, {
                "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794136627",
                "retry-after": "30", "Location": SIGNED, "Server": CANARY,
            }, io.BytesIO(CANARY.encode()))
            with self.subTest(code=code):
                calls, data, diagnostic, error = self.run_download([response])
                self.assertIsInstance(error, asset.AssetError)
                self.assertEqual(len(calls), 1)
                self.assertIsNone(data)
                self.assertIn(f"phase=api status={code}", diagnostic)
                self.assertIn("x-ratelimit-remaining=0", diagnostic)
                self.assertIn("retry-after=30", diagnostic)
                self.assert_safe_output(diagnostic + str(error))

    def test_redirect_destination403_is_distinct_and_has_no_auth(self):
        calls, data, diagnostic, error = self.run_download([
            Response(302, headers={"Location": SIGNED}), Response(403, body=CANARY.encode())])
        self.assertIsNotNone(error)
        self.assertIsNone(data)
        self.assertIn("phase=asset status=403", diagnostic)
        self.assertIsNone(calls[1][0].get_header("Authorization"))
        self.assert_safe_output(diagnostic + str(error))

    def test_malicious_rate_header_and_network_exception_are_not_logged(self):
        class BrokenRead(Response):
            def read(self, size=-1):
                raise OSError(CANARY + SIGNED)
        for replies in [
            [BrokenRead()],
            [Response(403, headers={"x-ratelimit-remaining": CANARY, "retry-after": "1\n" + CANARY})],
            [urllib.error.URLError(CANARY + SIGNED)],
        ]:
            calls, data, diagnostic, error = self.run_download(replies)
            self.assertIsNotNone(error)
            self.assertIsNone(data)
            self.assertEqual(len(calls), 1)
            self.assert_safe_output(diagnostic + str(error))

    def test_unsafe_redirects_and_redirect_limit_fail_closed(self):
        for location in ["", "http://assets.example.invalid/file", "https://user:password@assets.example.invalid/file"]:
            calls, data, diagnostic, error = self.run_download([Response(302, headers={"Location": location})])
            self.assertIsNotNone(error)
            self.assertIsNone(data)
            self.assertEqual(len(calls), 1)
            self.assert_safe_output(diagnostic + str(error))
        calls, data, diagnostic, error = self.run_download([Response(302, headers={"Location": SIGNED}) for _ in range(6)])
        self.assertIsNotNone(error)
        self.assertEqual(len(calls), 6)
        self.assertTrue(all(r.get_header("Authorization") is None for r, _ in calls[1:]))
        self.assert_safe_output(diagnostic + str(error))

    def test_oversize_partial_cleanup_and_existing_leaf_preservation(self):
        calls, data, diagnostic, error = self.run_download([Response(body=b"1234")], limit=3)
        self.assertIsNotNone(error)
        self.assertIsNone(data)
        calls, data, diagnostic, error = self.run_download([Response()], existing=b"keep")
        self.assertIsNotNone(error)
        self.assertEqual(data, b"keep")
        self.assert_safe_output(diagnostic + str(error))

    def test_non_api_urls_never_receive_job_token(self):
        for url in [SIGNED, "http://api.github.com/repos/a/b/releases/assets/1", API + "?token=x",
                    "https://api.github.com.evil.invalid/repos/a/b/releases/assets/1",
                    "https://user@api.github.com/repos/a/b/releases/assets/1"]:
            with patch.dict(os.environ, {"GITHUB_TOKEN": CANARY}), patch.object(asset.urllib.request, "build_opener") as build:
                with self.assertRaises(asset.AssetError):
                    asset.download_asset(url, Path("unused"), 100)
                build.assert_not_called()

    def stdlib_transfer(self, wires, entry="library"):
        # Only the socket connection is replaced. Real urllib/HTTPConnection and
        # HTTPResponse parsing create the protocol errors and validate the path.
        class WireSocket:
            def __init__(self, wire):
                self.wire, self.sent = wire, []
            def sendall(self, data):
                self.sent.append(bytes(data))
            def makefile(self, *args, **kwargs):
                return io.BytesIO(self.wire)
            def close(self):
                pass
        sockets = []
        def connect(connection):
            self.assertTrue(wires, "unexpected connection")
            connection.sock = WireSocket(wires.pop(0))
            sockets.append(connection.sock)
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {"GITHUB_TOKEN": CANARY}), patch.object(
                asset.urllib.request, "getproxies", return_value={}), patch.object(
                http.client.HTTPSConnection, "connect", connect):
            output = Path(d) / "download"
            diagnostic = io.StringIO()
            error = result = None
            with contextlib.redirect_stderr(diagnostic):
                try:
                    if entry == "cli":
                        with patch("sys.argv", ["github_asset.py", "--url", API, "--output", str(output),
                                                "--max-bytes", "2097152"]):
                            result = asset.main()
                    else:
                        asset.download_asset(API, output, 2097152)
                except Exception as failure:
                    error = failure
            data = output.read_bytes() if output.exists() else None
            sent = [b"".join(sock.sent) for sock in sockets]
            return result, error, data, diagnostic.getvalue(), sent

    def test_real_stdlib_protocol_errors_are_sanitized_in_library_and_main(self):
        cases = {
            "status": f"{CANARY}\r\n\r\n".encode(),
            "redirect": (f"HTTP/1.1 302 Found\r\nLocation: {SIGNED} bad\r\n"
                         "Content-Length: 0\r\n\r\n").encode(),
            # First read writes a full chunk; the next real chunk read is short.
            "read": (b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n100000\r\n"
                     + b"x" * 1048576 + b"\r\n20\r\n" + CANARY.encode()),
        }
        for name, wire in cases.items():
            for entry in ["library", "cli"]:
                with self.subTest(case=name, entry=entry):
                    result, error, data, diagnostic, sent = self.stdlib_transfer([wire], entry)
                    if entry == "library":
                        self.assertIsInstance(error, asset.AssetError)
                        self.assertTrue(error.__suppress_context__)
                        self.assert_safe_output(str(error))
                    else:
                        self.assertIsNone(error)
                        self.assertEqual(result, 1)
                    self.assertIsNone(data, "owned partial output must be cleaned")
                    self.assertEqual(len(sent), 1)
                    self.assert_safe_output(diagnostic)

    def test_real_stdlib_redirect_success_keeps_auth_on_api_only(self):
        wires = [(f"HTTP/1.1 302 Found\r\nLocation: {SIGNED}\r\nContent-Length: 0\r\n\r\n").encode(),
                 b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\narchive"]
        result, error, data, diagnostic, sent = self.stdlib_transfer(wires)
        self.assertIsNone(error)
        self.assertEqual(data, b"archive")
        self.assertEqual(len(sent), 2)
        self.assertIn(("Authorization: Bearer " + CANARY).encode(), sent[0])
        self.assertNotIn(b"Authorization:", sent[1])
        self.assertNotIn(CANARY.encode(), sent[1])
        self.assert_safe_output(diagnostic)

    def test_main_defense_handles_real_protocol_exception_classes(self):
        for error in [http.client.BadStatusLine(CANARY), http.client.InvalidURL(SIGNED),
                      http.client.IncompleteRead(CANARY.encode(), 1)]:
            with self.subTest(error=type(error).__name__), patch("sys.argv", [
                    "github_asset.py", "--url", API, "--output", "unused", "--max-bytes", "100"]), patch.object(
                    asset, "download_asset", side_effect=error):
                diagnostic = io.StringIO()
                with contextlib.redirect_stderr(diagnostic):
                    self.assertEqual(asset.main(), 1)
                self.assert_safe_output(diagnostic.getvalue())

    def test_interruption_and_exit_are_not_sanitized_and_still_clean_partial_output(self):
        for exception in [KeyboardInterrupt, SystemExit]:
            for phase in ["open", "read"]:
                with self.subTest(exception=exception.__name__, phase=phase), tempfile.TemporaryDirectory() as d:
                    output = Path(d) / "download"
                    response = Response()
                    response.read = Mock(
                        side_effect=[b"partial", exception()])
                    with patch.object(asset.urllib.request, "build_opener") as build:
                        if phase == "open":
                            build.return_value.open.side_effect = exception()
                        else:
                            build.return_value.open.return_value = response
                        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(exception):
                            asset.download_asset(API, output, 100)
                    self.assertFalse(output.exists())

    def test_cli_failure_cannot_print_exception_or_token(self):
        with patch.dict(os.environ, {"GITHUB_TOKEN": CANARY}), patch("sys.argv", [
                "github_asset.py", "--url", API, "--output", "unused", "--max-bytes", "100"]), patch.object(
                asset, "download_asset", side_effect=asset.AssetError(CANARY + SIGNED)):
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                self.assertEqual(asset.main(), 1)
            self.assert_safe_output(output.getvalue())


if __name__ == "__main__":
    unittest.main()
