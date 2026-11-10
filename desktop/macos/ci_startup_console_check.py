"""Required portable console controls with the exact nominated Q; never a native run."""
import argparse
import importlib.util
import os
from pathlib import Path
import sys
import unittest

from ci_qualifications import select_target
from ci_startup_fixture import TEST_SOURCE, test_contract


def nominated_revision():
    revision = select_target('all-342-startup-macos26')['test_source_sha']
    if revision != TEST_SOURCE:
        raise RuntimeError('Console control Q nomination differs')
    return revision


def admit_source(root):
    # Existing source admission checks exact clean checkout and the complete nominated inventory.
    root = Path(root).resolve(strict=True)
    test_contract(root)
    return root / 'desktop/macos/startup_xctest/StartupJourneys.swift'


def require_complete(result, expected=4):
    if not result.wasSuccessful() or result.skipped or result.testsRun != expected:
        raise RuntimeError(f'Required controls must pass all {expected} tests with zero skips')


def run_required(root, *, suite=None, stream=None, panel=False):
    if panel and sys.platform != 'darwin':
        raise RuntimeError('Compiled CoreGraphics panel policy requires Darwin, never Linux skip proof')
    source = admit_source(root)
    previous = os.environ.get('NAC_STARTUP_TEST_SOURCE')
    previous_panel = os.environ.get('NAC342_SWIFT_PANEL_PROOF')
    previous_ax = os.environ.get('NAC342_AX_WITNESS_PROOF')
    previous_contract = sys.modules.get('contract')
    os.environ['NAC_STARTUP_TEST_SOURCE'] = str(source)
    try:
        if panel:
            os.environ['NAC342_SWIFT_PANEL_PROOF'] = '1'
            os.environ['NAC342_AX_WITNESS_PROOF'] = '1'
        if suite is None:
            if panel:
                contract_spec = importlib.util.spec_from_file_location('contract', source.with_name('contract.py'))
                contract = importlib.util.module_from_spec(contract_spec)
                contract_spec.loader.exec_module(contract)
                sys.modules['contract'] = contract
                spec = importlib.util.spec_from_file_location('nominated_Q_panel_controls', source.with_name('test_contract.py'))
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                policy = unittest.defaultTestLoader.loadTestsFromTestCase(module.NativeFolderPolicyTests)
                diagnostic = unittest.defaultTestLoader.loadTestsFromTestCase(module.AXRefusalTests)
                if policy.countTestCases() != 6 or diagnostic.countTestCases() != 7:
                    raise RuntimeError('Require exact six geometry and seven AX actor/refusal controls')
                ax_spec = importlib.util.spec_from_file_location('nominated_Q_AX_controls', source.with_name('test_ax_witness.py'))
                ax_module = importlib.util.module_from_spec(ax_spec)
                ax_spec.loader.exec_module(ax_module)
                witness = unittest.defaultTestLoader.loadTestsFromTestCase(ax_module.ReceiptControls)
                if witness.countTestCases() != 22:
                    raise RuntimeError('Require exact twenty-two whole-client/request AX witness controls')
                suite = unittest.TestSuite([policy, diagnostic, witness])
            else:
                suite = unittest.defaultTestLoader.loadTestsFromName('test_ci_startup_console.StartupConsoleTests')
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
        require_complete(result, 35 if panel else 4)
        return result
    finally:
        if panel:
            if previous_contract is None:
                sys.modules.pop('contract', None)
            else:
                sys.modules['contract'] = previous_contract
        if previous_ax is None:
            os.environ.pop('NAC342_AX_WITNESS_PROOF', None)
        else:
            os.environ['NAC342_AX_WITNESS_PROOF'] = previous_ax
        if previous_panel is None:
            os.environ.pop('NAC342_SWIFT_PANEL_PROOF', None)
        else:
            os.environ['NAC342_SWIFT_PANEL_PROOF'] = previous_panel
        if previous is None:
            os.environ.pop('NAC_STARTUP_TEST_SOURCE', None)
        else:
            os.environ['NAC_STARTUP_TEST_SOURCE'] = previous


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resolve', action='store_true')
    parser.add_argument('--panel', action='store_true')
    parser.add_argument('--source-root', type=Path)
    args = parser.parse_args()
    if args.resolve:
        if args.source_root is not None or args.panel:
            parser.error('resolve takes no source root')
        print('revision=' + nominated_revision())
    else:
        if args.source_root is None:
            parser.error('required immutable Q source root missing')
        run_required(args.source_root, panel=args.panel)
