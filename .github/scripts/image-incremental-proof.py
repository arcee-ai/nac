#!/usr/bin/env python3
"""Private four-arm Wolfi compiler-state proof; never a quality/cache verdict."""
import datetime as dt
from decimal import Decimal, ROUND_CEILING
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

SOURCE_A = 'ae8c7955f23e27d9f0b42d4afbea07c68f6af0e1'
SOURCE_B = '2b0c550f96d2255640ac03b3a84d6527a547aaa0'
BRANCH = 'refs/heads/codex/all-582-image-incremental-proof'
DOCKERFILE_SHA = '9a489070ccc928932701a372e6d882a802065d7120f78d6acb5e47cd13e48740'
ARMS = [('baseline-A', SOURCE_A, False), ('baseline-B', SOURCE_B, False),
        ('candidate-A', SOURCE_A, True), ('candidate-B', SOURCE_B, True)]
GIB = 1024**3
RESERVE = int(3.3 * GIB)
DEPENDENCY = '    && cargo build --release --locked -p nac-server --bin nac-web\n'
CLEAN = 'RUN cargo clean --release --locked --offline --workspace \\\n    && NAC_BUILD_TRACK="${NAC_BUILD_TRACK}" \\\n'
CACHE_ENV = ('CARGO_INCREMENTAL=1 CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 ')
SOURCE_BUILD = '    cargo build --release --locked -p nac-server --bin nac-web\n'
CHECKPOINT = ('state=$(du -sk /src/nac/target/release/incremental)'
              ' && kib=${state%%[!0-9]*} && test -n "$kib" && test "$kib" -le 4194304')
RUNTIME_ENV = ('ACTIONS_CACHE_URL', 'ACTIONS_RESULTS_URL', 'ACTIONS_RUNTIME_TOKEN',
               'ACTIONS_RUNTIME_URL', 'ACTIONS_CACHE_SERVICE_V2')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def candidate_dockerfile(original, cache_id):
    """Exact reversible delta; the profile is aligned in BOTH Cargo builds."""
    require(digest(original.encode()) == DOCKERFILE_SHA, 'unreviewed Dockerfile')
    require(re.fullmatch(r'nac-image-incremental-[0-9]+-[0-9]+-candidate', cache_id),
            'unsafe private compiler cache id')
    require(original.count(DEPENDENCY) == original.count(CLEAN) == 1, 'ambiguous Cargo seams')
    dependency = DEPENDENCY.replace('cargo build', CACHE_ENV + 'cargo build')
    source = ('RUN cargo clean --release --locked --offline --workspace\n'
              f'RUN --mount=type=cache,id={cache_id},'
              'target=/src/nac/target/release/incremental,sharing=locked \\\n'
              '    units=0; for unit in /src/nac/target/release/incremental/nac_*; do '
              'if test -d "$unit"; then units=$((units+1)); fi; done; '
              'test "$units" -le 64 && printf "NAC_IMAGE_INCREMENTAL_PRE_UNITS=%s\\n" "$units" \\\n'
              f'    && {CACHE_ENV}NAC_BUILD_TRACK="${{NAC_BUILD_TRACK}}" \\\n')
    build = SOURCE_BUILD.rstrip('\n')+' \\\n    && '+CHECKPOINT+' && printf "NAC_IMAGE_INCREMENTAL_POST_KIB=%s\\n" "$kib"\n'
    generated = original.replace(DEPENDENCY, dependency).replace(CLEAN, source).replace(SOURCE_BUILD, build)
    require(generated.replace(dependency, DEPENDENCY).replace(source, CLEAN).replace(build, SOURCE_BUILD) == original,
            'Dockerfile reversal differs')
    return generated


def docker_rows(text):
    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    require({row['Type'] for row in rows} ==
            {'Images', 'Containers', 'Local Volumes', 'Build Cache'} and len(rows) == 4,
            'unknown Docker usage schema')
    return rows


def docker_bytes(text):
    """Conservative rounded logical usage, not a physical or billable byte claim."""
    rows = docker_rows(text)
    total = 0
    for row in rows:
        match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*(B|kB|MB|GB|TB)', row['Size'])
        require(match is not None, 'unknown Docker usage unit')
        value = Decimal(match[1])
        quantum = Decimal(1).scaleb(value.as_tuple().exponent)
        scale = {'B': 1, 'kB': 1000, 'MB': 1000**2, 'GB': 1000**3, 'TB': 1000**4}[match[2]]
        total += int(((value + quantum) * scale).to_integral_value(rounding=ROUND_CEILING))
    return total


def image_ids(text):
    ids = text.splitlines()
    require(all(re.fullmatch(r'sha256:[0-9a-f]{64}', value) for value in ids),
            'unknown Docker image identity')
    return sorted(set(ids))


def resource_accounting(baseline, logical, owned, output, free, previous_peak):
    """Fixed stock subtraction; independent high-water filesystem-growth fence."""
    growth = max(previous_peak, baseline['host_free_bytes']-free, 0)
    added = max(0, logical-baseline['Docker_logical_rounded_up_bytes'])
    return {'host_free_bytes': free, 'Docker_logical_rounded_up_bytes': logical,
            'Docker_incremental_logical_bytes': added,
            'owned_worktree_output_bytes': owned, 'output_bytes': output,
            'accounting_with_reservation_bytes': added+owned+RESERVE,
            'filesystem_growth_high_water_bytes': growth,
            'filesystem_growth_with_reservation_bytes': growth+RESERVE}


def supervise(argv, env, timeout, limit, state, tick=None):
    """Own/reap only this invocation's CLI/plugin group; bounded output/deadline."""
    start = time.monotonic()
    child = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, start_new_session=True)
    state.update(pid=child.pid, started_at=now(), argv=argv)
    output = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    try:
        while selector.get_map() or child.poll() is None:
            require(time.monotonic()-start < timeout, 'owned command deadline exceeded')
            if tick:
                tick()
            for key, _ in selector.select(0.25):
                data = os.read(key.fd, 65536)
                if not data:
                    selector.unregister(key.fileobj)
                else:
                    require(len(output)+len(data) <= limit, 'owned command output exceeded')
                    output.extend(data)
        child.wait(timeout=2)
    except BaseException:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            state['reap_failed'] = True
        state['interrupted_or_failed'] = True
        raise
    finally:
        selector.close()
        child.stdout.close()
        state.update(exit=child.returncode, seconds=time.monotonic()-start,
                     ended_at=now(), output_bytes=len(output), _output=bytes(output))
    return child.returncode


def compilation(log):
    # Cargo -vv also prints Fresh lines. Retain actual Compiling inventory,
    # rather than assuming source-only profile changes preserve external rlibs.
    log = re.sub(r'\x1b\[[0-9;]*m', '', log)
    vertices = set(re.findall(r'#(\d+) \[build\s+\d+/\d+\] RUN[^\n]*NAC_SOURCE_REVISION=[^\n]*cargo build', log))
    require(len(vertices) == 1, 'missing/ambiguous actual source RUN')
    vertex = next(iter(vertices))
    source = '\n'.join(line for line in log.splitlines() if re.search(r'#'+vertex+r'\s', line))
    def names(text):
        found = re.findall(r'\bCompiling ([A-Za-z0-9_-]+) v[^\s]+', text)
        return {'local': [n for n in found if n.startswith('nac-')],
                'external': [n for n in found if not n.startswith('nac-')]}
    return {'source': names(source), 'all': names(log), 'source_vertex': int(vertex),
            'source_run_cached': bool(re.search(r'#'+vertex+r' CACHED', source)),
            'incremental_rustc_flag': bool(re.search(r'-C\s*incremental=', source)),
            'incremental_paths': re.findall(r'-C\s*incremental=([^\s`]+)', source),
            'codegen16_rustc_flag': bool(re.search(r'-C\s*codegen-units=16\b', source))}


class Proof:
    def __init__(self, workspace, temporary, environment):
        self.workspace = workspace.resolve()
        self.environment = environment
        self.temp = temporary.resolve()
        self.output = self.temp/'image-incremental-proof-evidence'
        self.output.mkdir(mode=0o700)
        self.private = Path(tempfile.mkdtemp(prefix='nac-image-proof-', dir=self.temp))
        self.start = time.monotonic()
        self.last_usage = 0
        self.commands = []
        self.worktrees = []
        self.plain = {key: value for key, value in environment.items()
                      if key in ('PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'DOCKER_CONFIG')}
        self.secrets = [environment[key].encode() for key in
                        (*RUNTIME_ENV, 'GH_TOKEN', 'GITHUB_TOKEN')
                        if key.endswith('TOKEN') and environment.get(key)]
        self.report = {'status': 'failed', 'started_at': now(), 'arms': [
            {'name': name, 'source': source, 'incremental': inc, 'status': 'not-executed'}
            for name, source, inc in ARMS], 'resource_samples': [],
            'qualification': 'Private combined S08/S18 refinement;14 mechanisms/0of10 unchanged',
            'limits': {'controller_seconds': 4200, 'output_bytes': GIB,
                       'Docker_incremental_logical_plus_owned_and_reserve_early_bytes': 19*GIB,
                       'Docker_incremental_logical_cap_bytes': 20*GIB,
                       'filesystem_growth_plus_reserve_early_bytes': 19*GIB,
                       'output_reservation_bytes': RESERVE,
                       'host_free_early_bytes': 13*GIB, 'host_free_floor_bytes': 12*GIB},
            'guard_scope': 'Fixed initial Docker stock excluded from incremental logical budget; '
                'independent sampled host-free and high-water filesystem-growth fences. '
                'Global/raw usage retained; neither logical overlap nor filesystem delta '
                'is exact owned physical peak/cost.',
            'cache': 'Read existing S07 only; no shared compiler import/export/cache-to/image push'}

    def save(self):
        self.report['elapsed_seconds'] = time.monotonic()-self.start
        path = self.output/'report.pending'
        path.write_text(json.dumps(self.report, indent=2)+'\n')
        path.replace(self.output/'report.json')

    def redact(self, data):
        for secret in self.secrets:
            data = data.replace(secret, b'***')
        data = re.sub(rb'(?i)([?&](?:sig|signature|token|access_token|x-amz-signature)=)[^&\s"\']+',
                      rb'\1***', data)
        return data

    def command(self, label, argv, *, env=None, timeout=180, expected=(0,), monitor=True):
        state = {'label': label, 'started_at': now(), 'seconds': 0, 'exit': None}
        try:
            if not monitor and hasattr(self, 'cleanup_deadline'):
                remaining = self.cleanup_deadline-time.monotonic()
                require(remaining > 0, 'owned cleanup deadline exceeded')
                timeout = min(timeout, remaining)
            if monitor:
                self.guard()
            status = supervise([str(x) for x in argv], env or self.plain,
                min(timeout, max(1, 4200-(time.monotonic()-self.start))) if monitor else timeout,
                32*1024**2, state, self.guard if monitor else None)
            require(status in expected, f'{label}: exit {status}; no retry')
            return self.redact(state['_output']).decode(errors='replace'), status
        finally:
            data = self.redact(state.pop('_output', b''))
            (self.output/(label+'.log')).write_bytes(data)
            self.commands.append(state)
            (self.output/'commands.json').write_text(json.dumps(self.commands, indent=2)+'\n')

    def bind_resource_baseline(self):
        require('resource_baseline' not in self.report, 'resource baseline already bound')
        free = shutil.disk_usage(self.temp).free
        require(free >= 33*GIB, 'insufficient initial free-space budget')
        text, _ = self.command('usage-baseline',
            ['docker', 'system', 'df', '--format', '{{json .}}'], timeout=10, monitor=False)
        rows = docker_rows(text)
        logical = docker_bytes(text)
        for row in rows:
            require(re.fullmatch(r'[0-9]+', row.get('TotalCount', '')) is not None,
                    'unknown Docker usage count')
            if row['Type'] != 'Images':
                require(row['TotalCount'] == row.get('Active') == '0'
                        and row['Size'] == '0B', 'initial Docker cache/container/volume stock nonempty')
        ids, _ = self.command('baseline-images',
            ['docker', 'image', 'ls', '--all', '--quiet', '--no-trunc'], timeout=10, monitor=False)
        identities = image_ids(ids)
        require(len(identities) == int(next(row['TotalCount'] for row in rows if row['Type'] == 'Images')),
                'initial Docker image inventory differs from usage')
        self.report['resource_baseline'] = {'at': now(), 'host_free_bytes': free,
            'Docker_logical_rounded_up_bytes': logical, 'raw_categories': rows,
            'preexisting_image_ids': identities}
        self.save()
        self.guard(force=True)

    def guard(self, force=False):
        require(time.monotonic()-self.start < 4200, 'whole proof deadline exceeded')
        require('resource_baseline' in self.report, 'resource baseline unavailable')
        free = shutil.disk_usage(self.temp).free
        require(free >= 13*GIB, 'host free reserve reached')
        if not force and time.monotonic()-self.last_usage < 5:
            return
        self.last_usage = time.monotonic()
        text, _ = self.command(f'usage-{len(self.report["resource_samples"])}',
            ['docker', 'system', 'df', '--format', '{{json .}}'], timeout=10, monitor=False)
        logical = docker_bytes(text)
        ids, _ = self.command(f'images-{len(self.report["resource_samples"])}',
            ['docker', 'image', 'ls', '--all', '--quiet', '--no-trunc'], timeout=10, monitor=False)
        require(set(self.report['resource_baseline']['preexisting_image_ids']) <= set(image_ids(ids)),
                'initial Docker image stock drifted')
        owned = sum(p.stat().st_size for root in (self.output, self.private)
                    for p in root.rglob('*') if p.is_file() and not p.is_symlink())
        output = sum(p.stat().st_size for p in self.output.rglob('*') if p.is_file())
        peak = max((s['filesystem_growth_high_water_bytes'] for s in self.report['resource_samples']), default=0)
        sample = {'at': now(), **resource_accounting(self.report['resource_baseline'],
                  logical, owned, output, free, peak)}
        self.report['resource_samples'].append(sample)
        self.save()
        require(output <= GIB, 'owned evidence output bound reached')
        require(sample['accounting_with_reservation_bytes'] < 19*GIB,
                'owned Docker incremental logical budget early stop')
        require(sample['filesystem_growth_with_reservation_bytes'] < 19*GIB,
                'filesystem growth budget early stop')

    def preflight(self):
        e = self.environment
        require(sys.platform == 'linux' and os.geteuid() != 0 and platform.machine() == 'x86_64',
                'requires unprivileged native x86_64 Linux runner')
        require(e.get('GITHUB_REPOSITORY') == 'arcee-ai/nac' and e.get('GITHUB_EVENT_NAME') == 'push'
                and e.get('GITHUB_REF') == BRANCH, 'wrong diagnostic repository/event/ref')
        require(re.fullmatch(r'[0-9a-f]{40}', e.get('EXPECTED_CONTROLLER_SHA', '')),
                'invalid controller source')
        for key in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
            require(re.fullmatch(r'[1-9][0-9]*', e.get(key, '')), 'missing run/attempt')
        for key in ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH'):
            require(bool(e.get(key)), 'missing actual runner image identity')
        require(e['RUNNER_OS'] == 'Linux' and e['RUNNER_ARCH'] == 'X64', 'wrong runner platform')
        require(e.get('PROOF_BUILDER') == 'default', 'requires current default docker builder')
        require(all(e.get(key) for key in ('ACTIONS_RUNTIME_TOKEN', 'ACTIONS_RESULTS_URL')),
                'JavaScript action cache-read runtime unavailable')
        require(shutil.disk_usage(self.temp).free >= 33*GIB, 'insufficient initial free-space budget')
        self.bind_resource_baseline()
        head, _ = self.command('controller-source', ['git', '-C', self.workspace, 'rev-parse', 'HEAD'])
        require(head.strip() == e['EXPECTED_CONTROLLER_SHA'] == e.get('GITHUB_SHA'),
                'controller checkout differs from event source')
        self.command('source-ancestry', ['git', '-C', self.workspace, 'merge-base', '--is-ancestor',
                                       SOURCE_B, head.strip()])
        same, _ = self.command('pair-input-diff', ['git', '-C', self.workspace, 'diff', '--name-only',
            SOURCE_A, SOURCE_B, '--', 'docker/managed', 'Cargo.toml', 'Cargo.lock', '.dockerignore',
            '.cargo', '.github/security', 'scripts/security', 'crates'])
        require(not same.strip(), 'real source pair production/build inputs differ')
        capacity, _ = self.command('capacity', ['docker', 'info', '--format',
            '[{{.NCPU}},{{.MemTotal}},{{json .ServerVersion}},{{json .Driver}}]'])
        cpu, memory, version, driver = json.loads(capacity)
        require(cpu == 4 and 14*GIB <= memory <= 18*GIB and version.startswith('29.')
                and driver == 'overlayfs', 'runner capacity/Engine differs from supported baseline')
        self.command('buildx-version', ['docker', 'buildx', 'version'])
        self.command('builder', ['docker', 'buildx', 'inspect', '--builder', 'default'])
        containers, _ = self.command('initial-containers', ['docker', 'ps', '-aq', '--no-trunc'])
        require(not containers.strip(), 'ephemeral proof runner has existing containers')
        node, _ = self.command('policy-node-version', ['node', '--version'])
        require(node.strip() == 'v24.22.1', 'policy Node version differs')
        self.report.update(controller=head.strip(), sources=[SOURCE_A, SOURCE_B],
            run={key: e[key] for key in ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
                 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH')},
            capacity={'CPUs': cpu, 'memory_bytes': memory, 'Engine': version, 'driver': driver})
        for name, source in [('A', SOURCE_A), ('B', SOURCE_B)]:
            path = self.private/('source-'+name)
            self.command('worktree-'+name, ['git', '-C', self.workspace, 'worktree', 'add',
                                          '--detach', path, source])
            self.worktrees.append(path)
        self.guard(force=True)

    def build(self, row):
        name, source, incremental = row['name'], row['source'], row['incremental']
        context = self.private/('source-'+name[-1])
        original = (context/'docker/managed/Dockerfile').read_text()
        require(digest(original.encode()) == DOCKERFILE_SHA, 'wrong actual Dockerfile')
        cache_id = (f'nac-image-incremental-{self.environment["GITHUB_RUN_ID"]}-'
                    f'{self.environment["GITHUB_RUN_ATTEMPT"]}-candidate')
        generated = candidate_dockerfile(original, cache_id) if incremental else original
        # Instrument only the source RUN. Changing dependency verbosity would
        # needlessly invalidate the original trusted S07 dependency layer.
        seam = '\n    cargo build --release --locked'
        require(generated.count(seam) == 1, 'ambiguous source verbosity seam')
        generated = generated.replace(seam, '\n    cargo build -vv --release --locked')
        path = self.private/(name+'.Dockerfile')
        path.write_text(generated)
        (self.output/(name+'.Dockerfile')).write_text(generated)
        iid = self.private/(name+'.iid')
        metadata = self.private/(name+'-build-metadata.json')
        row.update(status='building', started_at=now(), Dockerfile_sha256=digest(generated.encode()),
                   compiler_state='fresh owned mount' if name == 'candidate-A' else
                   'same-job candidate-A mount' if incremental else 'disabled')
        self.save()
        build_env = {**self.plain, 'BUILDX_METADATA_PROVENANCE': 'max',
                     **{key: self.environment[key] for key in RUNTIME_ENV if key in self.environment}}
        text, _ = self.command(name+'-build', ['docker', 'buildx', 'build', '--builder', 'default',
            '--file', path, '--platform', 'linux/amd64', '--load', '--progress', 'plain',
            '--cache-from', 'type=gha,scope=nac-managed-linux-amd64-v1',
            '--build-arg', 'NAC_BUILD_TRACK=dev', '--build-arg', 'NAC_BUILD_ID=dev-'+source,
            '--build-arg', 'NAC_SOURCE_REVISION='+source, '--attest', 'type=provenance,disabled=true',
            '--attest', 'type=sbom,disabled=true', '--iidfile', iid, '--metadata-file', metadata,
            '--tag', 'nac-image-private:'+name.lower()+'-'+self.environment['GITHUB_RUN_ID'], context],
            env=build_env, timeout=1500)
        row['compilation'] = compilation(text)
        require(not row['compilation']['source_run_cached'], 'actual source RUN was cached')
        require(set(row['compilation']['source']['local']) == {'nac-contracts', 'nac-core', 'nac-server',
                'nac-managed', 'nac-process', 'nac-credential-store'}, 'real source compile inventory differs')
        if incremental:
            require(row['compilation']['incremental_rustc_flag'] and row['compilation']['codegen16_rustc_flag'],
                    'actual source rustc profile flags differ')
            require(all(path.startswith('/src/nac/target/release/incremental/')
                        for path in row['compilation']['incremental_paths']), 'foreign compiler cache path')
            units = re.findall(r'NAC_IMAGE_INCREMENTAL_PRE_UNITS=([0-9]+)', text)
            # The RUN title prints the printf format, not this numeric output.
            require(len(units) == 1, 'missing/ambiguous private cache presence')
            row['incremental_units_before'] = int(units[0])
            require((int(units[0]) == 0) if name == 'candidate-A' else (int(units[0]) > 0),
                    'unexpected cold/warm compiler mount state')
            size = re.findall(r'NAC_IMAGE_INCREMENTAL_POST_KIB=([0-9]+)', text)
            require(len(size) == 1 and int(size[0]) <= 4194304, 'missing/oversized compiler state')
            row['compiler_state_rounded_bytes'] = int(size[0])*1024
        image = iid.read_text().strip()
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'invalid actual build IID')
        inspected, _ = self.command(name+'-inspect', ['docker', 'image', 'inspect', image])
        details = json.loads(inspected)
        require(len(details) == 1 and details[0]['Id'] == image and details[0]['Architecture'] == 'amd64'
                and details[0]['Os'] == 'linux', 'actual loaded image binding differs')
        require(metadata.stat().st_size <= 8*1024**2, 'build metadata exceeds bound')
        raw_metadata = metadata.read_bytes()
        actual = json.loads(raw_metadata)
        require(actual.get('containerimage.digest') == image, 'build metadata and IID differ')
        invocation = actual['buildx.build.provenance']['invocation']
        args = invocation['parameters']['args']
        require(all(args.get('build-arg:'+key) == value for key, value in
                    {'NAC_BUILD_TRACK': 'dev', 'NAC_BUILD_ID': 'dev-'+source,
                     'NAC_SOURCE_REVISION': source}.items()) and
                invocation['environment']['platform'] == 'linux/amd64', 'actual build source/platform differs')
        materials = actual['buildx.build.provenance']['materials']
        require(len(materials) == 2 and all(m['uri'].startswith('pkg:docker/') for m in materials),
                'unexpected actual Docker build materials')
        materials = sorted(materials, key=lambda m: m['uri'])
        require(materials == self.report.get('build_materials', materials),
                'base/frontend changed between comparison arms')
        self.report['build_materials'] = materials
        (self.output/metadata.name).write_bytes(self.redact(raw_metadata))
        row['image'] = image
        row['build_seconds'] = next(c['seconds'] for c in self.commands if c['label'] == name+'-build')
        return context, image

    def validate_image(self, row, context, image):
        name, source = row['name'], row['source']
        dest = self.output/name
        private = self.private/(name+'-scanner')
        private.mkdir()
        row['status'] = 'validating'
        self.save()
        self.command(name+'-smoke', ['sh', context/'scripts/smoke-managed-image.sh'],
            env={**self.plain, 'TMPDIR': str(private), 'MANAGED_IMAGE': image,
                 'MANAGED_IMAGE_SKIP_BUILD': '1'}, timeout=180)
        guide, _ = self.command(name+'-offline-guide', ['docker', 'run', '--rm', '--network=none',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64',
            '--entrypoint=/usr/local/bin/nac-web', image, 'guide', 'skills', 'discovery'])
        guide = json.loads(guide)
        require(guide['provenance'] == 'first-party bundled NAC Guide' and
                '.nac/skills' in guide['result']['text'], 'offline Guide content differs')
        row['offline_guide_sha256'] = digest(json.dumps(guide, sort_keys=True).encode())
        policy = self.private/'source-B/.github/security/exceptions.json'
        common = ['--image', image, '--source-revision', source, '--trusted-policy', policy,
            '--candidate-policy', context/'.github/security/exceptions.json', '--tool-cache',
            private/'tools', '--db-cache', private/'db']
        self.command(name+'-inventory', [sys.executable, self.workspace/'scripts/security/image_scan.py',
            *common, '--output', dest/'inventory', '--inventory-only'], timeout=240)
        _, status = self.command(name+'-scan', [sys.executable, self.workspace/'scripts/security/image_scan.py',
            *common, '--output', dest/'security', '--bundle', dest/'inventory'], timeout=300, expected=(0, 1))
        self.command(name+'-report', [sys.executable, self.workspace/'scripts/security/image_ci_report.py',
            '--scan-output', dest/'security', '--scanner-exit', str(status), '--image', image,
            '--source-revision', source])
        # Actual offline Guide/source validation is already part of the unchanged
        # image build, image smoke and inventory; compare same-B runtime content.
        raw = json.loads((dest/'inventory/runtime.json').read_text())
        if name == 'candidate-B':
            baseline = json.loads((self.output/'baseline-B/inventory/runtime.json').read_text())
            require(raw == baseline, 'same-source runtime/package/supplier content differs')
            require(row['offline_guide_sha256'] == self.report['arms'][1]['offline_guide_sha256'],
                    'same-source offline Guide differs')
            row['same_B_runtime_parity'] = True
        row.update(status='complete', strict_scanner_exit=status, ended_at=now())
        shutil.rmtree(private)  # Only this arm's tools/DB; evidence remains.
        self.guard(force=True)
        self.save()

    def cleanup(self):
        self.cleanup_deadline = time.monotonic()+120
        failures = []
        for row in self.report['arms']:
            metadata = self.private/(row['name']+'-build-metadata.json')
            if metadata.exists():
                try:
                    require(metadata.stat().st_size <= 8*1024**2, 'build metadata exceeds bound')
                    (self.output/metadata.name).write_bytes(self.redact(metadata.read_bytes()))
                except Exception:
                    failures.append(row['name']+'-metadata')
            build = next((c for c in self.commands if c['label'] == row['name']+'-build'), None)
            if build:
                row.update(build_seconds=build['seconds'], build_exit=build['exit'])
            if 'image' not in row:
                continue
            try:
                ids, _ = self.command('remaining-'+row['name'], ['docker', 'ps', '-aq', '--no-trunc',
                    '--filter', 'ancestor='+row['image']], monitor=False, timeout=20)
                for index, container in enumerate(ids.splitlines()):
                    require(re.fullmatch(r'[0-9a-f]{64}', container), 'invalid container id')
                    raw, _ = self.command('remaining-inspect-'+row['name']+'-'+str(index),
                        ['docker', 'inspect', container], monitor=False, timeout=20)
                    detail = json.loads(raw)
                    require(len(detail) == 1 and detail[0]['Image'] == row['image'],
                            'refuse unrelated container cleanup')
                    # Initial container inventory was empty; only this job loaded
                    # these four exact images. Never use a broad name/prune kill.
                    self.command('remaining-remove-'+row['name']+'-'+str(index),
                        ['docker', 'rm', '-f', container], monitor=False, timeout=20)
            except Exception:
                failures.append(row['name']+'-container')
        for command in list(self.commands):
            if command['label'].endswith('-smoke') and isinstance(command.get('pid'), int):
                suffix = 'nac-managed-smoke-'+str(command['pid'])
                try:
                    self.command('cleanup-'+suffix, ['docker', 'rm', '-f', suffix],
                                 monitor=False, timeout=20, expected=(0, 1))
                    self.command('cleanup-'+suffix+'-volumes', ['docker', 'volume', 'rm',
                        *[suffix+'-'+part for part in ('state', 'repositories', 'home', 'config', 'bootstrap')]],
                        monitor=False, timeout=20, expected=(0, 1))
                    left, _ = self.command('cleanup-'+suffix+'-check', ['docker', 'volume', 'ls',
                        '--format', '{{.Name}}', '--filter', 'name=^'+suffix+'-'], monitor=False, timeout=20)
                    require(not left.strip(), 'owned smoke volume remains')
                except Exception:
                    failures.append(suffix)
        for i, path in enumerate(self.worktrees):
            try:
                self.command('cleanup-worktree-'+str(i), ['git', '-C', self.workspace,
                    'worktree', 'remove', '--force', path], monitor=False, timeout=30)
            except Exception:
                failures.append(str(path))
        return failures

    def run(self):
        try:
            self.preflight()
            self.command('live-qualification', [sys.executable,
                self.workspace/'scripts/security/image_qualify.py', '--output', self.output/'qualification',
                '--tool-cache', self.private/'qualifier-tools', '--db-cache', self.private/'qualifier-db'],
                timeout=360)
            shutil.rmtree(self.private/'qualifier-tools')
            shutil.rmtree(self.private/'qualifier-db')
            for row in self.report['arms']:
                self.validate_image(row, *self.build(row))
            self.report['status'] = 'four arms complete; private mechanism proof only'
            self.report['external_profile_recompilation'] = {
                row['name']: {'all': len(row['compilation']['all']['external']),
                              'source': len(row['compilation']['source']['external'])}
                for row in self.report['arms']}
        except BaseException as error:
            self.report['error'] = str(error) or type(error).__name__
            for row in self.report['arms']:
                if row['status'] in ('building', 'validating'):
                    row.update(status='failed', ended_at=now())
        finally:
            # Never prune Docker/shared caches or manipulate another worktree.
            failures = self.cleanup()
            if not failures:
                shutil.rmtree(self.private)
            self.report['cleanup'] = {'private_root_removed': not self.private.exists(),
                'failed_worktrees': failures, 'Docker': 'No prune/removal; ephemeral job-owned VM lifecycle'}
            if failures or self.private.exists():
                self.report['status'] = 'failed'
            self.report['ended_at'] = now()
            self.save()
        print(json.dumps({'status': self.report['status'], 'report': str(self.output/'report.json')}))
        return 0 if self.report['status'] == 'four arms complete; private mechanism proof only' else 1


def main():
    workspace = Path(os.environ.get('GITHUB_WORKSPACE', ''))
    temporary = Path(os.environ.get('RUNNER_TEMP', ''))
    require(workspace.is_absolute() and temporary.is_absolute() and temporary.is_dir(),
            'requires actual Actions workspace/temp')
    def interrupted(_signum, _frame):
        raise InterruptedError('owned diagnostic interrupted')
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupted)
    return Proof(workspace, temporary, dict(os.environ)).run()


if __name__ == '__main__':
    raise SystemExit(main())
