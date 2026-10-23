#!/usr/bin/env python3
"""Benign compiler/ABI/tool compatibility checks inside the managed runtime."""
import ctypes
import hashlib
import json
import locale
import os
from pathlib import Path
import shlex
import ssl
import subprocess
import tempfile


def run(*args):
    return subprocess.check_output(args, text=True).strip()


assert (os.getuid(), os.getgid()) == (10001, 10001)
owned = list(Path("/usr/share/nac/package-provenance").glob("*.json"))
assert len(owned) == 5, "owned package provenance incomplete"
for record in owned:
    package = json.loads(record.read_text())
    assert package["supplier"] == "NAC" and package["schema_version"] == 1
    for filename, evidence in package["installed_payload"].items():
        path = Path(filename)
        if "symlink" in evidence:
            assert path.is_symlink() and str(path.readlink()) == evidence["symlink"], filename
        else:
            assert hashlib.sha256(path.read_bytes()).hexdigest() == evidence["sha256"], filename
runtime_provenance = json.loads(Path("/usr/share/nac/runtime-provenance.json").read_text())
assert runtime_provenance["packages"] and runtime_provenance["notice_files"]
locale.setlocale(locale.LC_ALL, "")
assert locale.getpreferredencoding(False).lower().replace("-", "") == "utf8"
assert run("node", "-p", "JSON.stringify({value: 6 * 7, bytes: Buffer.byteLength('é')})") == '{"value":42,"bytes":2}'
with tempfile.TemporaryDirectory(prefix="nac-runtime-", dir="/repositories") as directory:
    root = Path(directory)
    for compiler, suffix, source in [
        ("cc", "c", '#include <stdio.h>\nint main(void) { puts("42"); return 0; }\n'),
        ("c++", "cc", '#include <iostream>\n#include <vector>\nint main() { std::vector<int> v{40,2}; std::cout << v[0]+v[1]; }\n')]:
        code, binary = root / ("probe." + suffix), root / ("probe-" + suffix)
        code.write_text(source)
        subprocess.run([compiler, str(code), "-o", str(binary)], check=True)
        assert run(str(binary)) == "42"
    code, binary = root / "ssl.c", root / "ssl"
    code.write_text('#include <openssl/crypto.h>\nint main(void) { return (OpenSSL_version_num() >> 28) != 3; }\n')
    subprocess.run(["cc", str(code), "-o", str(binary),
                    *shlex.split(run("pkg-config", "--cflags", "--libs", "openssl"))], check=True)
    subprocess.run([str(binary)], check=True)
    subprocess.run(["python3", "-m", "venv", str(root / "venv")], check=True)
    assert "pip " in run(str(root / "venv/bin/python"), "-m", "pip", "--version")
    data = root / "data.txt"
    data.write_text("runtime-transfer-ok\n")
    assert run("curl", "--fail", "--silent", data.as_uri()) == "runtime-transfer-ok"

# Load each installed SASL mechanism with its actual dependencies, without
# performing authentication, protocol fuzzing or malformed-message validation.
plugins = Path("/usr/lib/sasl2")
for name in ["anonymous", "crammd5", "digestmd5", "gs2", "gssapiv2", "login",
             "plain", "sasldb", "scram", "sql"]:
    ctypes.CDLL(str(plugins / ("lib" + name + ".so.3")))
context = ssl.create_default_context()
try:
    context.wrap_bio(ssl.MemoryBIO(), ssl.MemoryBIO(), server_hostname=None)
except ValueError as error:
    assert "server_hostname" in str(error)
else:
    raise AssertionError("Python SSL accepted missing required hostname")
context.wrap_bio(ssl.MemoryBIO(), ssl.MemoryBIO(), server_hostname="example.com")

curl = run("curl", "--version")
protocols = set(next(line for line in curl.splitlines() if line.startswith("Protocols:")).split()[1:])
features = set(next(line for line in curl.splitlines() if line.startswith("Features:")).split()[1:])
# NAC uses HTTP(S); retain the requested SSH/LDAP/authentication capabilities too.
# Upstream-removed incidental protocols are reported, not invented NAC contracts.
required_protocols = set("file http https ldap ldaps scp sftp".split())
required_features = set("GSS-API HTTP2 HTTP3 Kerberos NTLM SPNEGO SSL zstd".split())
print(json.dumps({"uid": os.getuid(), "locale": locale.setlocale(locale.LC_ALL),
                  "compiler_python_node_abi": "passed", "sasl_plugins": "loaded",
                  "curl": curl, "missing_protocols": sorted(required_protocols - protocols),
                  "upstream_removed_capabilities": ["RTMP", "SMB/SMBS", "TLS-SRP"],
                  "missing_features": sorted(required_features - features)}, indent=2), flush=True)
assert required_protocols <= protocols, "managed curl lost an existing protocol"
assert required_features <= features, "managed curl lost an existing feature"
