"""Disposable deterministic fixture ownership. No user repositories accepted."""
import os
from pathlib import Path
import subprocess
import tempfile

from probe import Probe


class Repo:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nac-all417-')
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@invalid')
        self.git('config', 'core.autocrlf', 'false')
        self.git('config', 'core.filemode', 'true')
        self.put('tracked', b'base\n')
        self.commit()

    def git(self, *args, data=None):
        return Probe(self.root).git(*args, data=data)

    def put(self, path, data):
        path = self.root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def commit(self):
        self.git('add', '--all')
        self.git('commit', '-qm', 'fixture')

    def close(self):
        # Unreadable ignored trees are intentional. Restore fixture permissions.
        for root, dirs, _files in os.walk(self.root):
            for name in dirs:
                path = Path(root) / name
                if not path.is_symlink():
                    path.chmod(0o755)
        self.temp.cleanup()
