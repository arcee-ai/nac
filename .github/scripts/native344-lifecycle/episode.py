"""P12 finite composition over the maintained handle, cleanup and export owners."""
import json
import os
from pathlib import Path
import signal
import sys
import time

import consumer as c


def episode():
    value = c.declaration(os.environ['ROOT_LIFECYCLE_ADMISSION'])
    epochs = c.admit(value, os.environ)
    h, p = (Path(os.environ[k]) for k in ('H_ROOT', 'P_ROOT'))
    contract, owner, supervisor = c.owners(h)
    from ci_qualifications import require_checkout
    from ci_paths_budget import Bound, using
    from ci_lifecycle_evidence import capacity, export_plan, images, FINAL_METADATA_BYTES
    from ci_lifecycle_finalization import prepare, result_guard, ledger_guard, finalize
    from ci_support import redact_values
    import ci
    controller = c.HERE.parents[2]
    for root, sha in ((controller, value['controller_sha']), (h, c.H), (p, c.P)):
        contract.canonical(root)
        require_checkout(root, sha)
    c.require(len({controller, h, p}) == 3 and all(not a.is_relative_to(b)
        for a in (controller, h, p) for b in (controller, h, p) if a != b), 'disjoint source checkouts')
    c.require(ci.command(['git', 'rev-parse', 'HEAD^'], cwd=controller) == c.BASE,
              'controller is an exact child of the explicit source start')
    output = contract.canonical(Path(os.environ['LIFECYCLE_OUTPUT']), exists=False)
    c.require(not output.exists() and all(not output.is_relative_to(x) and not x.is_relative_to(output)
        for x in (controller, h, p)), 'absent disjoint private episode output')
    output.mkdir(mode=0o700)
    raw, exported, package = (output / name for name in ('raw', 'evidence', 'package'))
    raw.mkdir(mode=0o700)
    control = raw / 'lifecycle'
    control.mkdir(mode=0o700)
    clock = c.common.make_clock(epochs, Bound)
    ci.RUN_DEADLINE = clock.cleanup.deadline
    report = dict(result='failed', scope=c.SCOPE, admission=value, H=c.H, P=c.P,
        compiler_roles={'Swift_lifecycle_image_reader': 1, 'Rust': 0, 'SDK': 0,
                        'product_app_engine_observer_rebuilds': 0}, phases=[],
        lifecycle_transactions_accepted=False, full_G3_accepted=False,
        composited_paint_acceptance=False, trusted_input_acceptance=False,
        signature_qualified=False, minimum_os_qualified=False)
    replacements = [*redact_values(), (str(p), '<product-checkout>'), (str(h), '<harness-checkout>')]
    ledger = None

    def run(argv, log, cap, *, cwd=h, env=None):
        clock.require_phase('helper-' + Path(str(argv[0])).name, cap + 15)
        phase = dict(argv=list(map(str, argv)), cap_seconds=cap, status='RUNNING')
        report['phases'].append(phase)
        try:
            with using(clock.work):
                ci.run(argv, log, cap, cwd=cwd, env=env, abort=lambda: bool(c.common.STOP))
            proof = json.loads(log.with_name(log.name + '.ownership.json').read_bytes())
            c.require(proof['accepted'] and proof['reaped'] and proof['drain_settled']
                and not proof['unknown'] and proof['teardown_error'] is None, 'positive accepted helper handle')
            phase['status'] = 'PASS'
        finally:
            if phase['status'] != 'PASS':
                phase['status'] = 'FAIL'

    def console():
        log = control / ('console-' + str(len(report['phases'])) + '.log')
        run([sys.executable, '-B', str(c.HERE / 'consumer.py'), 'console', str(p)], log, 15, cwd=p)
        observed = json.loads(log.read_text())
        contract.require_console(observed)
        return observed

    try:
        with using(clock.work):
            actual = dict(os=ci.command(['/usr/bin/sw_vers', '-productVersion']),
                xcode=ci.command(['xcodebuild', '-version']), sdk=ci.command(['xcrun', '--sdk', 'macosx', '--show-sdk-version']))
            c.require(os.environ.get('ImageVersion') == '20261102.0473.1'
                and actual['os'].startswith('26.') and actual['xcode'].strip() == 'Xcode 26.6\nBuild version 17F113'
                and actual['sdk'].strip() == '26.5', 'reviewed hosted image and toolchain')
            report['toolchain'] = actual
            report['kernel'] = ci.command(['/usr/bin/uname', '-a'])
            setup_environment = dict(os.environ, RUSTUP_AUTO_INSTALL='0', GIT_OPTIONAL_LOCKS='0')
        for label, root in (('controller', controller), ('H', h), ('P', p)):
            run(['make', 'setup'], raw / (label + '-setup.log'), 600, cwd=root, env=setup_environment)
        report['console_preflight'] = console()
        with using(clock.work):
            metadata = json.loads(Path(os.environ['PRODUCER_RUN_METADATA']).read_bytes())
            artifact = json.loads(Path(os.environ['PRODUCER_ARTIFACT_METADATA']).read_bytes())
            report['producer'] = c.launch.artifact_identity(value, metadata, artifact)
            manifest, archive, body = c.handoff(Path(os.environ['DOWNLOAD_ROOT']), value)
            package.mkdir(mode=0o700)
            for file in (manifest, archive):
                shutil_copy(file, package / file.name)
        run(['/usr/bin/ditto', '-x', '-k', str(package / archive.name), str(package)], raw / 'extract.log', 90)
        with using(clock.work):
            report['package_integrity'] = c.verify_package(p, package, c.MANIFEST)
            app, observer = package / body['bundle']['name'], package / body['observer']['name']
            builds = dict(app=str(app), observer=str(observer), manifest_sha256=c.MANIFEST,
                observer_sha256=c.digest(observer), lifecycle_build=body['native_build_receipt'],
                export_capacity=capacity())
            contract.persist(control / 'builds.json', builds)
            helper = output / 'lifecycle-image-reader'
            helper_source = h / 'desktop/macos/CILifecycleImages.swift'
            source_hash = c.digest(helper_source)
        run(['xcrun', 'swiftc', '-swift-version', '5', str(helper_source), '-o', str(helper)],
            raw / 'image-reader-build.log', 90)
        c.require(c.digest(helper_source) == source_hash, 'image helper source changed')
        helper_hash = c.digest(helper)
        contract.persist(control / 'readers.json', dict(observer_sha256=c.digest(observer),
            image_reader_sha256=helper_hash, image_reader_source_sha256=source_hash))
        contract.persist(control / 'finalization-contract.json', prepare(report, builds, replacements))
        export_plan(raw, replacements, completed=(), reserve=FINAL_METADATA_BYTES)
        capsule = dict(value, harness=value['controller_sha'])
        ledger = contract.Ledger(control, capsule, os.environ['GITHUB_RUN_ID'], binding=contract.Binding.P12)
        environment = dict(os.environ, NAC_LIFECYCLE_SOURCE=str(p), LIFECYCLE_CONTROL=str(control))
        completed = []

        def reserve(name):
            with using(clock.work):
                for root, sha in ((controller, value['controller_sha']), (h, c.H), (p, c.P)):
                    require_checkout(root, sha)
                c.admit(value, os.environ)
                c.verify_package(p, package, c.MANIFEST)
                c.require(c.digest(helper) == helper_hash, 'image reader changed')
                observed = console()
                ledger.reserve(name, control / name, observed, dict(source_sha=c.P,
                    harness_sha=value['controller_sha'], builds_sha256=c.digest(control / 'builds.json'),
                    observer_sha256=c.digest(observer), command=c.driver_command(p, name, app, control / name, observer)))

        def driver(name):
            environment['NAC_LIFECYCLE_SCENARIOS'] = name
            return supervisor.run_case(c.driver_command(p, name, app, control / name, observer),
                control / name / 'runner.log', environment, owner=owner, binding=contract.Binding.P12)

        def native_report(argv, log):
            clock.require_phase('image-readability', 25)
            with using(clock.work):
                return supervisor.image_report(argv, log, cwd=h)

        def validate(name):
            destination = control / name
            summary = json.loads((destination / 'summary.json').read_bytes())
            assets = {name: row['sha256'] for name, row in body['source']['assets']['files'].items()}
            proof = contract.require_case(summary, name, body['native_build_receipt'], assets, binding=contract.Binding.P12)
            owner.require(destination, name, proof['native'])
            # The unchanged P12 driver owns all minimized/document/incarnation,
            # duplicate/Cancel/second-confirmation/Stop and restart assertions.
            snapshots = images(destination, name, helper, native_report, raw)
            return dict(summary_sha256=c.digest(destination / 'summary.json'), images=snapshots,
                        shutdown_seconds=proof['shutdown_seconds'])

        def publish(name, outcome):
            result = control / name / 'external-result.json'
            contract.persist(result, outcome)
            result_guard(raw, result, replacements)
            completed.append(name)
            # A failed/unknown case can preserve a partial roster, never pass.
            if outcome['status'] == 'passed':
                export_plan(raw, replacements, completed=completed, final=name == c.CASES[-1], reserve=FINAL_METADATA_BYTES)
            else:
                export_plan(raw, replacements, failed_cases=completed, reserve=FINAL_METADATA_BYTES)
            outcome['external_result_sha256'] = c.digest(result)
            ledger_guard(ledger.value, replacements)

        report['cases'] = c.serial(ledger, clock, using, reserve=reserve, driver=driver, validate=validate,
            cleanup=lambda name: supervisor.audit_cleanup(control / name, observer, supervisor.read_residual, owner=owner),
            publish=publish, finish_guard=lambda state: ledger_guard(state, replacements))
        report.update(result='passed', lifecycle_transactions_accepted=True)
    except BaseException as error:
        report.update(result='failed', error_type=type(error).__name__, error=str(error)[:4096])
        raise
    finally:
        if ledger is not None:
            ledger.close()
        # Cleanup/export cannot renew work. H finalization retains partial failed
        # evidence and rejects any incomplete or oversized successful roster.
        with using(clock.retention):
            finalize(raw, exported, report, replacements,
                     crashes=Path.home() / 'Library/Logs/DiagnosticReports', started=epochs[0])


def shutil_copy(source, destination):
    import shutil
    shutil.copyfile(source, destination)
    c.require(c.digest(source) == c.digest(destination), 'unchanged original role transfer')


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, frame: c.common.STOP.append(number))
    episode()
