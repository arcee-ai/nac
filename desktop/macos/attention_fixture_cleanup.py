"""Attention fixture website/root custody; no process or file IO on import."""
import json
import os
import re
import subprocess
import time
import uuid

from attention_reset_readout import unique_object


def write_input(owned, value):
    """Publish only into the original held root, never a replacement pathname."""
    owned.validate()
    fd = os.open('cleanup-input.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=owned.fd)
    try:
        with os.fdopen(fd, 'w', closefd=False) as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)
    owned.validate()


def run_helper(owned, helper, environment, record=None):
    """Keep the original helper and directory capabilities through late exit."""
    owned.validate()
    input_bytes, input_proof = owned.read('cleanup-input.json', limit=65536)
    json.loads(input_bytes, object_pairs_hook=unique_object)
    process = subprocess.Popen([str(helper), str(owned.root), str(owned.fd), str(owned.parent_fd)],
                               env=environment, pass_fds=(owned.fd, owned.parent_fd))
    evidence = dict(pid=process.pid, argv=process.args, input_proof=input_proof,
                    root_generation=list(owned.expected), parent_generation=list(owned.parent_identity))
    try:
        if record is not None:
            record(evidence)
        assert process.wait(timeout=15) == 0, 'Website cleanup helper failed'
    finally:
        # Timeout/interruption/receipt failure is still failure. It cannot
        # release the original capabilities while a callback remains live.
        while True:
            try:
                if process.poll() is not None:
                    break
                time.sleep(0.25)
            except BaseException:
                pass
        evidence['exit_code'] = process.wait()
    owned.validate()
    after_input, after_proof = owned.read('cleanup-input.json', limit=65536)
    assert after_input == input_bytes and after_proof == input_proof, 'Cleanup input changed'
    raw, _ = owned.read('cleanup-result.json', limit=65536)
    result = json.loads(raw, object_pairs_hook=unique_object)
    assert result['root'] == str(owned.root) and result['initialization_ephemeral'] is True
    assert re.fullmatch('[0-9a-f]{64}', result['profile'])
    assert uuid.UUID(result['website_store_removed'])
    for key, expected in zip(('root_device', 'root_inode', 'parent_device', 'parent_inode'),
                             (*owned.expected, *owned.parent_identity)):
        assert type(result[key]) is int and result[key] == expected, 'Cleanup generation mismatch'
    owned.validate()
    return result


def cleanup_fixture(owned, helper, environment, destination=None):
    """Called only after the drivers positively settle native/provider owners."""
    result = run_helper(owned, helper, environment)
    if destination is not None:
        for name in ('cleanup-input.json', 'cleanup-result.json'):
            raw, _ = owned.read(name, limit=65536)
            (destination / name).write_bytes(raw)
    owned.remove(dict(native=True, provider=True, website=True))
    return result
