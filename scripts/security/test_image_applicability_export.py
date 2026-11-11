"""Opt-in real Docker export control; only disposable owned scratch resources."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import uuid

import image_applicability_evidence as evidence


@unittest.skipUnless(os.environ.get("NAC_TEST_DOCKER_EXPORT") == "1", "set NAC_TEST_DOCKER_EXPORT=1 for local Docker control")
class DockerUnderlyingFilesystemTests(unittest.TestCase):
    def test_volume_path_retains_underlying_image_file_in_never_started_export(self):
        token = uuid.uuid4().hex
        tag = "nac-applicability-export-fixture:" + token
        container = "nac-applicability-export-fixture-" + token
        source, text = "b" * 40, b"benign underlying image volume fixture\n"
        image_created = container_created = False

        def docker(*arguments):
            return subprocess.check_output(["docker", *arguments], text=True).strip()

        with tempfile.TemporaryDirectory(prefix="nac-underlying-export-") as temporary:
            root = Path(temporary)
            (root / "fixture.txt").write_bytes(text)
            (root / "Dockerfile").write_text("""FROM scratch
ARG NAC_SOURCE_REVISION
ARG FIXTURE_ID
LABEL org.opencontainers.image.revision="${NAC_SOURCE_REVISION}"
LABEL io.arcee.nac.fixture="${FIXTURE_ID}"
COPY fixture.txt /declared/fixture.txt
VOLUME ["/declared"]
CMD ["/never-started"]
""")
            try:
                docker("build", "--quiet", "--platform", "linux/amd64", "--build-arg", "NAC_SOURCE_REVISION=" + source,
                       "--build-arg", "FIXTURE_ID=" + token, "--tag", tag, str(root))
                image_created = True
                image = docker("image", "inspect", "--format", "{{.Id}}", tag)
                inspected = json.loads(docker("image", "inspect", image))
                docker("create", "--platform", "linux/amd64", "--name", container, "--network", "none", "--read-only", image)
                container_created = True
                container_inspected = json.loads(docker("container", "inspect", container))
                subject = evidence.subject_identity(image, source, inspected)
                volumes = evidence.export_container(image, inspected, container_inspected)
                self.assertEqual(subject["platform"], "linux/amd64")
                self.assertEqual(volumes, ["/declared"])
                archive = root / "filesystem.tar"
                docker("container", "export", "--output", str(archive), container)
                with tarfile.open(archive, "r:") as bundle:
                    self.assertEqual(bundle.extractfile("declared/fixture.txt").read(), text)
                filesystem, _, _ = evidence.filesystem_profile(archive)
                self.assertEqual(filesystem["scope"], "final-underlying-image-filesystem")
                self.assertEqual(filesystem["entries"]["/declared/fixture.txt"]["sha256"], hashlib.sha256(text).hexdigest())
                after = json.loads(docker("container", "inspect", container))[0]
                self.assertEqual(after["State"]["StartedAt"], "0001-01-01T00:00:00Z")
            finally:
                if container_created:
                    docker("container", "rm", "--volumes", container)
                if image_created:
                    docker("image", "rm", tag)


if __name__ == "__main__":
    unittest.main()
