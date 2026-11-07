#!/usr/bin/env python3
"""Sole writer for NAC's pinned timezone assets; never consult the host tzdb."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import tempfile

VERSION = '2026f'
INPUTS = {
    'tzcode2026f.tar.gz': '5a18da01393679ef2559214dc687563f7f3d05691f6f58b7fbc0166f3e796cd6',
    'tzdata2026f.tar.gz': '01b4a91cec5167ed48c11e8ab78f2048cead78ce94b0cafcad0ae8c5a3044d3d',
}
SOURCES = ('africa', 'antarctica', 'asia', 'australasia', 'europe',
           'northamerica', 'southamerica', 'etcetera', 'backward')
CFLAGS = '-O2 -DHAVE_GETTEXT=0'
ANNOUNCEMENT = 'https://lists.iana.org/hyperkitty/list/tz-announce@iana.org/thread/LPANPBYMCHJI4WKAII4J6BVXLCFVGRHM/'
SHA512 = {
    'tzcode2026f.tar.gz': 'eefcea60c37857214e1eba768d1bbd096de2a8f5afc9a776555552922cc174b32892d7442097b699b77efcba4d85649ed7d13e752ffdbcaad1050749c6c7b5aa',
    'tzdata2026f.tar.gz': '26189803c8b3e903dcc467404e2feefb7d190cb1870249a23577ce31e9dcbf187e4704e0b45c8d1366d1c501bb5b53a2e80f8e2828b2163be15e532f6acab52d',
}
OUTPUT_NAMES = {'zones.bin', 'index.tsv', 'manifest.json', 'LICENSE', 'NOTICE'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unpack(archives, source):
    for name, expected in INPUTS.items():
        archive = archives / name
        content = archive.read_bytes()
        if digest(content) != expected or hashlib.sha512(content).hexdigest() != SHA512[name]:
            raise ValueError('Pinned IANA input hash mismatch: ' + name)
        with tarfile.open(archive) as reader:
            for item in reader:
                path = PurePosixPath(item.name)
                if (not item.isfile() or path.is_absolute() or len(path.parts) != 1
                        or '..' in path.parts):
                    raise ValueError('Non-flat or non-regular IANA input: ' + item.name)
                target = source / str(path)
                data = reader.extractfile(item).read()
                if target.exists() and target.read_bytes() != data:
                    raise ValueError('Inconsistent official input: ' + str(path))
                target.write_bytes(data)
    if (source / 'version').read_text().strip() != VERSION:
        raise ValueError('IANA version mismatch')


def notices(source):
    # Retain official public-domain statement AND named BSD exceptions. These
    # are license headers only, not imported date/strftime implementations.
    result = ['NAC timezone data: official IANA ' + VERSION + '\n',
              'Only zic is compiled; date.c/strftime.c are not shipped or linked.\n',
              'The source archives name the following BSD exceptions:\n']
    for name in ('date.c', 'strftime.c'):
        text = (source / name).read_text()
        start = text.index('/* Copyright')
        end = text.index('*/', start) + 2
        result.extend(['\n--- ' + name + ' ---\n', text[start:end] + '\n'])
    text = (source / 'newstrftime.3').read_text()
    result.extend(['\n--- newstrftime.3 ---\n', text[:text.index('.TH ')], '\n'])
    return (''.join(result).rstrip() + '\n').encode()


def generate(archives):
    environment = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR')
                   if key in os.environ}
    environment.update(LC_ALL='C', TZ='UTC', SOURCE_DATE_EPOCH='0')
    with tempfile.TemporaryDirectory(prefix='nac-tzdata-') as temporary:
        root = Path(temporary)
        source, compiled = root / 'source', root / 'compiled'
        source.mkdir()
        compiled.mkdir()
        unpack(archives, source)
        # Build the exact pinned official compiler, not /usr/sbin/zic. No
        # install target or global timezone destination is ever invoked.
        subprocess.run(['make', 'zic', 'CC=cc', 'CFLAGS=' + CFLAGS],
                       cwd=source, env=environment, check=True, timeout=60)
        version = subprocess.check_output([str(source / 'zic'), '--version'],
                                          text=True, env=environment, timeout=5).strip()
        if not version.endswith(' ' + VERSION):
            raise ValueError('Unexpected compiled zic version: ' + version)
        subprocess.run([str(source / 'zic'), '-b', 'fat', '-d', str(compiled),
                        *SOURCES], cwd=source, env=environment, check=True, timeout=30)
        pack, index, locations = bytearray(), [], {}
        for file in sorted(compiled.rglob('*')):
            if file.is_symlink():
                raise ValueError('Unexpected generated symlink')
            if not file.is_file():
                continue
            name = file.relative_to(compiled).as_posix()
            data = file.read_bytes()
            if not data.startswith(b'TZif') or any(c.isspace() for c in name):
                raise ValueError('Unexpected zone output: ' + name)
            key = digest(data)
            if key not in locations:
                locations[key] = (len(pack), len(data))
                pack.extend(data)
            offset, length = locations[key]
            if pack[offset:offset + length] != data:
                raise ValueError('Zone hash collision')
            index.append(f'{name}\t{offset}\t{length}\n')
        output = {'zones.bin': bytes(pack), 'index.tsv': ''.join(index).encode(),
                  'LICENSE': (source / 'LICENSE').read_bytes(), 'NOTICE': notices(source)}
        manifest = {
            'writer': 'scripts/timezone-data/generate.py', 'version': VERSION,
            'inputs': [{'url': 'https://data.iana.org/time-zones/releases/' + name,
                        'sha256': value, 'sha512': SHA512[name]}
                       for name, value in sorted(INPUTS.items())],
            'provenance': {'official_release_announcement': ANNOUNCEMENT,
                           'admission': 'Official HTTPS plus matching published SHA512',
                           'detached_signatures': 'NOT VERIFIED; no signature authentication claimed'},
            'compiler': {'source': 'tzcode2026f.tar.gz', 'make_target': 'zic',
                         'cc': 'cc', 'cflags': CFLAGS, 'options': ['-b', 'fat'],
                         'data_sources': list(SOURCES), 'leap_seconds': False},
            'names': len(index), 'unique_tzif_blobs': len(locations),
            'coverage': 'Main IANA zones and backward aliases; no Factory/localtime/host rules.',
            'files': {name: {'bytes': len(data), 'sha256': digest(data)}
                      for name, data in sorted(output.items())},
        }
        output['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archives', type=Path, required=True,
                        help='Previously authenticated official pinned release archives')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true', help='Compare only; never rewrite output')
    args = parser.parse_args()
    if args.output.is_symlink() or (args.output.exists() and not args.output.is_dir()):
        raise SystemExit('Refusing non-directory or symlink timezone output')
    entries = list(args.output.iterdir()) if args.output.exists() else []
    unexpected = any(x.name not in OUTPUT_NAMES or x.is_symlink() or not x.is_file()
                     for x in entries)
    if args.check and (unexpected or {x.name for x in entries} != OUTPUT_NAMES):
        raise SystemExit('NAC timezone assets drift from pinned inputs/writer')
    if unexpected:
        raise SystemExit('Refusing unexpected entries in timezone output directory')
    result = generate(args.archives.resolve())
    if args.check:
        if any((args.output / name).read_bytes() != data for name, data in result.items()):
            raise SystemExit('NAC timezone assets drift from pinned inputs/writer')
        print('NAC timezone assets match pinned writer and inputs')
        return
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in result.items():
        (args.output / name).write_bytes(data)
    print(json.dumps({'version': VERSION, 'files': len(result),
                      'bytes': sum(map(len, result.values()))}))


if __name__ == '__main__':
    main()
