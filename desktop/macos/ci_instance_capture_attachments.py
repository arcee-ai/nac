"""Read a bounded H-normalized selected export; never invoke xcresulttool.

The future SDK adapter must establish actual test/result origin independently
and construct this finite index. This reader proves only structural joins and
retains valid pairs in memory even if a later pair fails. It writes nothing.
"""
from dataclasses import dataclass
import math
import os
from pathlib import Path
import re
import stat

from ci_instance_capture_contract import (MAX_IMAGES, MAX_PNG, MAX_RECORD, MAX_TEXT, PUBLIC_FIELDS,
    build_resource, closed, decode, digest, encoded, finite_positive, frames, path_text,
    private_frame, require, require_pins, require_resource, semantic_receipts, hex_text)

TEST_IDENTIFIER = 'InstanceCaptureJourneys/testFullInstanceCapture()'
TEST_URL = 'test://com.apple.xcode/NACInstanceCaptureUITests/NACInstanceCaptureUITests/InstanceCaptureJourneys/testFullInstanceCapture'
ORIGIN_FIELDS = {'test_identifier', 'test_identifier_url', 'result_bundle_sha256', 'resource_sha256', 'result'}
PAIR_FIELDS = {'ordinal', 'key', 'metadata', 'png', 'metadata_sha256', 'png_sha256'}
METADATA_FIELDS = {'schema', 'resource_sha256', 'phase_before', 'phase_after', 'bundle_path',
                   'quartz_bounds', 'pixel_size', 'scale', 'png_sha256', 'png_bytes', 'foreground'}
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def generation(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def close_descriptor(fd, primary=None):
    try:
        os.close(fd)
    except OSError:
        if primary is None:
            raise
        primary.instance_capture_close_failed = True


class ExportDirectory:
    """Pin one existing private export, walking every ancestor without links."""
    def __init__(self, path):
        spelling = os.fspath(path)
        require(path_text(spelling), 'absolute canonical export spelling')
        self.path, self.fd = Path(spelling), None
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        primary = None
        try:
            for part in self.path.parts[1:]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                previous, fd = fd, child
                os.close(previous)
            info = os.fstat(fd)
            require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                    'private owned export directory')
            self.identity = (info.st_dev, info.st_ino)
            self.fd, fd = fd, None
            self.check()
        except BaseException as error:
            primary = error
            if self.fd is not None:
                close_descriptor(self.fd, primary)
                self.fd = None
            raise
        finally:
            if fd is not None:
                close_descriptor(fd, primary)

    def check(self):
        # Rewalk rather than resolve/stat through a newly replaced ancestor.
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        primary = None
        try:
            for part in self.path.parts[1:]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                previous, fd = fd, child
                os.close(previous)
            info = os.fstat(fd)
            held = os.fstat(self.fd)
            require((info.st_dev, info.st_ino) == self.identity == (held.st_dev, held.st_ino)
                    and info.st_uid == held.st_uid == os.geteuid()
                    and stat.S_IMODE(info.st_mode) == stat.S_IMODE(held.st_mode) == 0o700,
                    'export directory replaced or no longer private')
        except BaseException as error:
            primary = error
            raise
        finally:
            close_descriptor(fd, primary)

    def read(self, name, limit):
        require(type(name) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', name)
                and name not in ('.', '..'), 'flat export filename')
        self.check()
        fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=self.fd)
        primary = None
        try:
            first = os.fstat(fd)
            require(stat.S_ISREG(first.st_mode) and first.st_uid == os.geteuid() and first.st_nlink == 1
                    and not first.st_mode & 0o022 and 0 < first.st_size <= limit,
                    'regular bounded owned export file')
            data = bytearray()
            while len(data) < first.st_size:
                part = os.read(fd, min(65536, first.st_size - len(data)))
                require(bool(part), 'export short read')
                data.extend(part)
            require(not os.read(fd, 1) and generation(first) == generation(os.fstat(fd))
                    == generation(os.stat(name, dir_fd=self.fd, follow_symlinks=False)),
                    'export file changed or replaced during read')
            self.check()
            return bytes(data)
        except BaseException as error:
            primary = error
            raise
        finally:
            close_descriptor(fd, primary)

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            os.close(fd)


@dataclass(frozen=True)
class Collection:
    report: dict
    # Validated metadata/PNG bytes only. Caller owns any later durable writing.
    pairs: tuple


class CollectionError(ValueError):
    def __init__(self, partial):
        super().__init__('Instance capture structural collection incomplete; inspect retained prefix')
        self.partial = partial


def require_origin(origin, resource_raw):
    closed(origin, ORIGIN_FIELDS)
    require(origin['test_identifier'] == TEST_IDENTIFIER and origin['test_identifier_url'] == TEST_URL
            and origin['result'] == 'Passed' and hex_text(origin['result_bundle_sha256'], 64)
            and origin['resource_sha256'] == digest(resource_raw), 'selected result/test/resource origin')


def require_metadata(raw, png, phase, app, resource_sha):
    value = closed(decode(raw), METADATA_FIELDS)
    for name in ('phase_before', 'phase_after'):
        closed(value[name], PUBLIC_FIELDS)
        require(encoded(value[name]) == encoded(phase), 'public before/after phase binding')
    require(value['schema'] == 'nac343-public-capture-v1' and value['resource_sha256'] == resource_sha
            and value['bundle_path'] == app['bundle_path'] and value['foreground'] is True
            and type(value['png_bytes']) is int and value['png_bytes'] == len(png)
            and value['png_sha256'] == digest(png) and png.startswith(PNG_SIGNATURE), 'public PNG binding/signature')
    bounds, pixels, scale = value['quartz_bounds'], value['pixel_size'], value['scale']
    require(type(bounds) is list and len(bounds) == 4 and type(pixels) is list and len(pixels) == 2
            and all(type(n) in (int, float) and math.isfinite(n) for n in bounds)
            and all(finite_positive(n) for n in bounds[2:]) and finite_positive(scale)
            and all(type(n) is int and 0 < n <= 32768 for n in pixels)
            and bounds[2] * scale == pixels[0] and bounds[3] * scale == pixels[1], 'declared geometry/scale')
    return value


def collect(export, index_raw, resource_raw, pins, origin, evidence):
    """Join full nineteen or raise CollectionError with only the valid prefix.

    evidence is host-retained bytes: manifest, prepared, summary, and nineteen
    {configuration, request, fence, diagnostic} records. Never reopen T paths.
    origin is an independent host nomination, not derived from index contents.
    Original files are untouched, including on failure. Hash/signature checks
    neither decode PNGs nor establish native paint, TCC, cleanup or input proof.
    """
    accepted, rows = [], []
    report = dict(schema='nac343-structural-collection-v1', structurally_complete=False,
                  native_acceptance='unqualified', semantic_validation_required=True,
                  image_decoding_required=True, frames=rows, semantic_receipts=[],
                  text_bytes=0, image_bytes=0, rejected_input_retained=False)
    directory = None
    primary = None
    def budget(data, image=False, limit=MAX_RECORD):
        require(type(data) is bytes and 0 < len(data) <= (MAX_PNG if image else limit), 'input byte bound')
        key, cap = ('image_bytes', MAX_IMAGES) if image else ('text_bytes', MAX_TEXT)
        require(report[key] + len(data) <= cap, 'aggregate evidence bound')
        report[key] += len(data)
    try:
        require_pins(pins)
        pins_copy = dict(pins)
        resource = require_resource(resource_raw, pins_copy)
        budget(resource_raw)
        require_origin(origin, resource_raw)
        report['origin'] = dict(origin)
        index = closed(decode(index_raw, MAX_TEXT), {'schema', 'origin', 'attachments'})
        budget(index_raw, limit=MAX_TEXT)
        require(index['schema'] == 'nac343-selected-export-v1' and index['origin'] == origin,
                'independently nominated export origin')
        entries = index['attachments']
        require(type(entries) is list and len(entries) <= 19, 'finite attachment index')
        # Aliased file identities make even earlier entries ambiguous.
        names = []
        for entry in entries:
            closed(entry, PAIR_FIELDS)
            for key, suffix in (('metadata', '.json'), ('png', '.png')):
                name = entry[key]
                require(type(name) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', name)
                        and name.endswith(suffix), 'flat selected attachment filename')
                names.append(name)
        require(len(names) == len(set(names)), 'aliased attachment filenames')
        closed(evidence, {'manifest', 'prepared', 'summary', 'frames'})
        for key in ('manifest', 'prepared', 'summary'):
            budget(evidence[key], limit=MAX_TEXT if key == 'summary' else MAX_RECORD)
        require(build_resource(evidence['manifest'], evidence['prepared'], pins_copy) == resource_raw,
                'retained preparation/resource projection')
        report['semantic_receipts'] = semantic_receipts(evidence['summary'], resource)
        require(type(evidence['frames']) is list and len(evidence['frames']) == 19, 'nineteen retained private frames')
        directory = ExportDirectory(export)
        nonces, journeys, coexist = set(), {}, {}
        for expected, entry, retained in zip(frames(), entries, evidence['frames']):
            require(type(entry['ordinal']) is int and entry['ordinal'] == expected['ordinal']
                    and entry['key'] == expected['key'], 'attachment gap/order/replay')
            closed(retained, {'configuration', 'request', 'fence', 'diagnostic'})
            for key in ('configuration', 'request', 'fence'):
                budget(retained[key])
            budget(retained['diagnostic'], image=True)
            require(retained['diagnostic'].startswith(PNG_SIGNATURE), 'diagnostic PNG signature')
            phase, state = private_frame(retained['configuration'], retained['request'], retained['fence'], expected, resource)
            require(phase['request_nonce'] not in nonces, 'replayed request nonce')
            nonces.add(phase['request_nonce'])
            journey = expected['key'].rsplit('/', 1)[0]
            identity = tuple(phase[k] for k in ('app_pid', 'app_incarnation', 'app_launch_epoch', 'window_number'))
            # Conflict -> workspace may legitimately replace its NSWindow.
            # The app incarnation remains fixed within one native episode.
            scope = (digest(retained['configuration']), identity[:3])
            require(journey not in journeys or journeys[journey] == scope, 'journey app/configuration replacement')
            journeys[journey] = scope
            if journey == 'app-crash/replacement':
                require(identity[:3] != journeys['app-crash/initial'][1][:3], 'app crash lacks replacement incarnation')
            if journey.startswith('coexist/'):
                coexist[expected['track']] = identity
                require(len(coexist) < 2 or coexist['dev'][0] != coexist['stable'][0], 'coexisting app PID crossed')
            metadata = directory.read(entry['metadata'], MAX_RECORD)
            budget(metadata)
            png = directory.read(entry['png'], MAX_PNG)
            budget(png, image=True)
            require(digest(metadata) == entry['metadata_sha256'] and digest(png) == entry['png_sha256'],
                    'selected attachment digest')
            app = resource['apps'][1 if expected['track'] == 'stable' else 0]
            require_metadata(metadata, png, phase, app, digest(resource_raw))
            rows.append(dict(expected, metadata_sha256=digest(metadata), png_sha256=digest(png),
                             configuration_sha256=digest(retained['configuration']), request_sha256=digest(retained['request']),
                             fence_sha256=digest(retained['fence']), diagnostic_sha256=digest(retained['diagnostic']),
                             private_window_frame=state['window_frame'], private_content_bounds=state['content_bounds']))
            accepted.append((metadata, png))
        require(len(rows) == 19 and len(journeys) == 10, 'incomplete nineteen-frame export')
        directory.check()
        report['structurally_complete'] = True
    except BaseException as error:
        primary = error
        report['structurally_complete'] = False
        report['failure_type'] = type(error).__name__
        if getattr(error, 'instance_capture_close_failed', False):
            report['descriptor_close_failed'] = True
        partial = Collection(report, tuple(accepted))
        if isinstance(error, (ValueError, OSError, TypeError, KeyError, OverflowError, RecursionError)):
            raise CollectionError(partial) from error
        # Preserve cancellation/unexpected failure identity and its valid prefix.
        # This is evidence retention, never authority to resume or retry.
        error.instance_capture_partial = partial
        raise
    finally:
        if directory is not None:
            try:
                directory.close()
            except OSError:
                if primary is None:
                    report['structurally_complete'] = False
                    report['failure_type'] = 'export-close'
                    raise CollectionError(Collection(report, tuple(accepted))) from None
                report['export_close_failed'] = True
    return Collection(report, tuple(accepted))
