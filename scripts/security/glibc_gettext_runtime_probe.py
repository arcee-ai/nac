"""Exercise gettext LANGUAGE path handling in the installed glibc runtime.

This is a behavioral smoke check, not a supplier build or CVE disposition.
The normal-language control must translate before the traversal assertion is
meaningful; otherwise a missing locale or unreadable catalog could pass it.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import hashlib


DOMAIN = "nac-gettext-path-probe"
SOURCE = r"""
#include <libintl.h>
#include <locale.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 3 || setlocale(LC_ALL, "de_DE.utf8") == NULL ||
        bindtextdomain("nac-gettext-path-probe", argv[1]) == NULL ||
        textdomain("nac-gettext-path-probe") == NULL ||
        setenv("LANGUAGE", argv[2], 1) != 0)
        return 2;
    const char *translated = gettext("needle");
    if (translated == NULL)
        return 3;
    puts(translated);
    return 0;
}
"""


def catalog(translation: bytes) -> bytes:
    original = b"needle\0"
    translated = translation + b"\0"
    # GNU MO: header, one original descriptor, one translation descriptor.
    return b"".join(
        (
            struct.pack("<7I", 0x950412DE, 0, 1, 28, 36, 0, 0),
            struct.pack("<2I", len(original) - 1, 44),
            struct.pack("<2I", len(translated) - 1, 44 + len(original)),
            original,
            translated,
        )
    )


def run() -> None:
    # The managed smoke container mounts /tmp with noexec. Its repository
    # volume is writable by the managed UID and permits executing the probe.
    executable_temp = "/repositories" if Path("/repositories").is_dir() else None
    with tempfile.TemporaryDirectory(prefix="nac-glibc-gettext-", dir=executable_temp) as directory:
        root = Path(directory)
        catalog_root = root / "catalogs"
        valid = catalog_root / "safe" / "LC_MESSAGES"
        escaped = root / "outside" / "LC_MESSAGES"
        valid.mkdir(parents=True)
        escaped.mkdir(parents=True)
        locale_root = root / "locale"
        shutil.copytree("/usr/lib/locale/C.utf8", locale_root / "de_DE.utf8")
        (valid / f"{DOMAIN}.mo").write_bytes(catalog(b"SAFE"))
        (escaped / f"{DOMAIN}.mo").write_bytes(catalog(b"ESCAPED"))

        source = root / "probe.c"
        binary = root / "probe"
        source.write_text(SOURCE)
        subprocess.run(("cc", "-O0", "-Wall", "-Wextra", "-Werror", "-o", str(binary), str(source)), check=True)

        def translate(language: str) -> str:
            env = os.environ.copy()
            env.pop("LANGUAGE", None)
            env["LOCPATH"] = str(locale_root)
            completed = subprocess.run(
                (str(binary), str(catalog_root), language),
                check=True,
                capture_output=True,
                text=True,
                env=env,
            )
            return completed.stdout.strip()

        valid_result = translate("safe")
        if valid_result != "SAFE":
            raise AssertionError(f"valid-language catalog did not load: {valid_result!r}")
        traversal_result = translate("../outside")
        if traversal_result != "needle":
            raise AssertionError(f"LANGUAGE traversal loaded a catalog: {traversal_result!r}")
        libc = Path("/usr/lib/libc.so.6")
        print(
            "installed glibc gettext: valid catalog loaded; traversal catalog rejected; "
            f"libc_sha256={hashlib.sha256(libc.read_bytes()).hexdigest()}"
        )


if __name__ == "__main__":
    run()
