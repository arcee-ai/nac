"""Pinned P package and H direct-owned setup-engine diagnostic, never acceptance."""
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
import sys
import time


def prepare_engine_operation(h, product, tests, private):
    # Keep H's original owned process-group adapter for the exact product
    # package owner and every startup preflight capture. Its fixed phase markers
    # go to private output, never into the diagnostic artifact.
    import ci
    from ci_startup import product_package_owner
    from ci_startup_fixture import prepare_profile, prepare_configuration
    from ci_startup_api import configuration_selection, setup_engine, seed_model
    from ci_qualifications import require_checkout
    product_sha = '06296d236d42422ede804856de6f240a06d9c535'
    ci.RUN_DEADLINE = ci.qualification_deadline(time.monotonic(), 'startup')
    def owned(argv, log, timeout, cwd=h, **kwargs):
        with (private / 'owned-phase-private.log').open('a') as sink, redirect_stdout(sink):
            return ci.run(argv, log, timeout, cwd=cwd, retain_ownership=True, **kwargs)

    require_checkout(product, product_sha)
    owner = product_package_owner(product)
    engine, package = private / 'product-engine', private / 'product-package'
    owned([sys.executable, '-B', str(owner), 'prepare-engine', '--track', 'dev', '--output', str(engine)],
          private / 'engine-build.log', 1800, cwd=product)
    owned([sys.executable, '-B', str(owner), 'normal', '--engine-receipt', str(engine / 'engine-build.json'),
           '--output', str(package)], private / 'package-build.log', 240, cwd=product)
    manifest = package / 'manifest.json'
    owned([sys.executable, '-B', str(owner), 'verify', str(manifest), '--signatures'],
          private / 'package-verify.log', 90, cwd=product)
    require_checkout(product, product_sha)

    @contextmanager
    def operation(provider_base):
        profile = prepare_profile(private, 'configuredLocal', provider_base + '/models-dev', run=owned, directory=private)
        config, _, _ = prepare_configuration(profile, package / 'NAC.app', manifest, product, tests, product_sha,
                                              run=owned, directory=private)
        configuration_selection(profile, Path(config['app_path']) / 'Contents/Resources/nac-web',
                                run=owned, directory=private)
        # H owns this direct child, endpoint verification, fixture-only settings,
        # and its original termination/wait path. No JSON PID drives cleanup.
        with setup_engine(profile, config, private / 'settings-engine.log') as setup:
            seed_model(setup['base_url'], provider_base)
            yield
        # No invented fixture/process settlement receipt or private-tree removal.

    return operation
