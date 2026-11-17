#!/usr/bin/env python3
"""Paired negative controls on the final, source-locked libssh2 composition.

The historical Debian patch reversals precede NAC's overlapping publickey
follow-ups. These test-only mutations exercise the same two vulnerable seams
after those follow-ups, without changing the installed package or policy.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


SOURCE = Path("src/publickey.c")
PINS = Path("/recipe/sources.lock.json")
FIXED_BINARY = Path("/tmp/libssh2-regressions")

COMMENT_GUARD = """                    if(pkey->listFetch_data_len <
                       (size_t)(pkey->listFetch_s - pkey->listFetch_data) + comment_len) {
                        _libssh2_error(session, LIBSSH2_ERROR_BUFFER_TOO_SMALL,
                                 "ListFetch data too short");
                        goto err_exit;
                    }

"""
ENTRY_ZEROING = """                memset(&list[keys], 0,
                       (max_keys - keys + 1) * sizeof(list[keys]));"""
TERMINATOR_ONLY = """                memset(&list[keys + 1], 0,
                       (max_keys - keys) * sizeof(list[keys]));"""

CASES = (
    ("66034", COMMENT_GUARD, "", "23493ad766babaee4aae138b9f790982122452208cfc5f54e8c8863f7b419e2b",
     ("unexpected comment attribute allocation: 1",
      "FAIL CVE-2026-66034 publickey comment overrun")),
    ("58051", ENTRY_ZEROING, TERMINATOR_ONLY,
     "a341cf280e350a0ea4e9d84bb96f65f0655dea9d675965977609d14bad265f84",
     ("ERROR: AddressSanitizer: SEGV", "libssh2_publickey_list_free",
      "case_58051_uninitialised_entry", "FAIL CVE-2026-58051 uninitialised list entry")),
)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def run_case(binary, case_id):
    return subprocess.run(
        [str(binary), f"--publickey-{case_id}-only"],
        capture_output=True, text=True, timeout=30, check=False,
    )


def main():
    source = SOURCE.read_bytes()
    expected = json.loads(PINS.read_text())["libssh2"]["reviewed_source_files"][str(SOURCE)]
    if digest(source) != expected:
        raise SystemExit("final libssh2 publickey source differs from reviewed lock")
    if not FIXED_BINARY.is_file():
        raise SystemExit("missing compiled final-source regression binary")

    original = source.decode("utf-8")
    with tempfile.TemporaryDirectory(prefix="libssh2-final-publickey-") as temp:
        for case_id, old, new, mutant_sha, expected_failure in CASES:
            fixed = run_case(FIXED_BINARY, case_id)
            if fixed.returncode != 0 or "all regression cases passed" not in fixed.stdout:
                raise SystemExit(f"CVE-2026-{case_id}: final fixed control failed: "
                                 f"{fixed.stdout}{fixed.stderr}")
            if original.count(old) != 1:
                raise SystemExit(f"CVE-2026-{case_id}: final source seam changed")
            mutant = original.replace(old, new).encode("utf-8")
            if digest(mutant) != mutant_sha:
                raise SystemExit(f"CVE-2026-{case_id}: test-only mutation changed")
            changed = Path(temp, f"publickey-{case_id}.c")
            changed.write_bytes(mutant)
            binary = Path(temp, f"regressions-{case_id}")
            compile_result = subprocess.run(
                ["gcc", "-g", "-fsanitize=address", "-fno-omit-frame-pointer",
                 "-DHAVE_CONFIG_H", "-I.", "-Isrc", "-Iinclude",
                 "-Wl,--allow-multiple-definition", "-o", str(binary),
                 "/recipe/libssh2-regressions.c", str(changed), "src/misc.c",
                 "src/sftp.c", "src/.libs/libssh2.a", "-lcrypto", "-lz"],
                capture_output=True, text=True, timeout=120, check=False,
            )
            if compile_result.returncode != 0:
                raise SystemExit(f"CVE-2026-{case_id}: mutant compile failed: "
                                 f"{compile_result.stdout}{compile_result.stderr}")
            vulnerable = run_case(binary, case_id)
            output = vulnerable.stdout + vulnerable.stderr
            if vulnerable.returncode == 0 or not all(part in output for part in expected_failure):
                raise SystemExit(f"CVE-2026-{case_id}: final-source mutation did not "
                                 f"distinguish the vulnerable seam: {output}")
            print(f"CVE-2026-{case_id}: final source {expected}; mutant {mutant_sha}; "
                  "fixed passed; isolated negative control failed as expected")


if __name__ == "__main__":
    main()
