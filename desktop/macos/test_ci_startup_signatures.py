"""Inert proposal characterization: filesystem copies only, no build/sign/launch."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import struct
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

W = Path(os.environ.get('NAC_PROPOSAL_SOURCE', str(Path(__file__).resolve().parents[2]))).resolve()
import ci_xctest_project as m


class PortProposalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='nac-inert-port-proposal-')
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name).resolve()
        self.parent = self.folder / 'profiles'
        self.parent.mkdir(mode=0o700)
        self.root = self.parent / 'nac342-xctest-configuredLocal-abc12345'
        self.root.mkdir(mode=0o700)
        self.proof = self.root / 'ax-witness'
        self.proof.mkdir(mode=0o700)
        self.port = self.proof / 'requests'
        self.port.mkdir(mode=0o700)
        self.profile = dict(root=self.root, scenario='configuredLocal')
        self.declaration = dict(path=str(self.proof / 'receipt.json'), nonce='a'*64,
            helper_path='/inert/helper', helper_sha256='b'*64,
            support_sha256={}, owner_pid=os.getpid(), deadline_ns='12345')
        self.config = dict(schema='nac342-startup-xctest-v1', scenario='configuredLocal',
                           ax_witness=copy.deepcopy(self.declaration))
        self.project = self.folder / 'original' / m.PROJECT.name
        (self.project / m.SCHEME.parent).mkdir(parents=True)
        base = (W / m.PROJECT / 'project.pbxproj').read_bytes()
        self.generated = m.source_variant(base, Path('/inert/Native.swift'),
            Path('/inert/Startup.swift'), 'c'*64, m.TARGETS[2], 'STARTUP')
        (self.project / 'project.pbxproj').write_bytes(self.generated)
        scheme = (W / m.PROJECT / m.SCHEME).read_bytes()
        for name in (m.SCHEME.name, m.TARGETS[2] + '.xcscheme'):
            (self.project / m.SCHEME.parent / name).write_bytes(scheme)
        self.selection = dict(project=str(self.project), scheme=m.TARGETS[2],
            receipt=dict(generated=True, expected_target=m.TARGETS[2],
                         generated_project_sha256=m.digest(self.generated),
                         selected_scheme_sha256=m.digest(scheme), ordinary_scheme_sha256=m.digest(scheme)))
        self.output = self.folder / 'proposal-output'

    def propose(self, **changes):
        data = json.dumps(self.config, sort_keys=True).encode()
        args = dict(owned_profile=self.profile, profiles_root=self.parent,
                    declaration=self.declaration, output=self.output)
        args.update(changes)
        return m.private_request_selection(self.selection, data, m.digest(data), **args)

    def test_exact_grant_nonce_receipt_and_original_target_preserved(self):
        actual = self.propose()
        values = plistlib.loads((self.output / 'StartupPrivatePort.entitlements').read_bytes())
        self.assertEqual(values, {
            'com.apple.application-identifier': plistlib.loads(NORMAL_RUNNER_XML.encode())[
                'com.apple.application-identifier'],
            'com.apple.security.app-sandbox': True,
            m.PRIVATE_PORT_WRITE: [str(self.port) + '/']})
        generated = (Path(actual['project']) / 'project.pbxproj').read_text()
        # Compare every original A object byte-for-byte, not just setting counts.
        pattern = r'^    A[0-9]{23} = \{\n.*?^    \};'
        self.assertEqual(re.findall(pattern, generated, re.M|re.S),
                         re.findall(pattern, self.generated.decode(), re.M|re.S))
        self.assertEqual((self.project / 'project.pbxproj').read_bytes(), self.generated)
        self.assertEqual(generated.count('CODE_SIGN_ENTITLEMENTS ='), 1)
        self.assertIn('ENABLE_APP_SANDBOX = YES;', generated)
        self.assertIn('CODE_SIGN_INJECT_BASE_ENTITLEMENTS = YES;', generated)
        receipt = actual['receipt']['private_request_proposal']
        self.assertEqual(receipt['nonce'], self.declaration['nonce'])
        self.assertFalse(receipt['acceptance'])
        self.assertFalse(receipt['actual_runner_entitlements_verified'])
        self.assertFalse(receipt['actual_testbundle_entitlements_verified'])

    def test_request_entitlements_cannot_rebind_selected_application_identity(self):
        changed = self.generated.replace(b'ai.arcee.nac.ci.startup-ui-tests',
                                         b'ai.arcee.nac.ci.another-ui-tests')
        self.assertNotEqual(changed, self.generated)
        (self.project / 'project.pbxproj').write_bytes(changed)
        self.selection['receipt']['generated_project_sha256'] = m.digest(changed)
        with self.assertRaisesRegex(RuntimeError, 'application identity'):
            self.propose()
        self.assertFalse(self.output.exists())

    def test_invalid_or_unbound_nonce_rejected_before_output(self):
        for nonce in ('', 'A'*64, 'a'*63, '../bad', 'b'*64):
            with self.subTest(nonce=nonce):
                self.config['ax_witness']['nonce'] = nonce
                with self.assertRaises(RuntimeError): self.propose()
                self.assertFalse(self.output.exists())
        for nonce in ('', 'A'*64, 'a'*63, '../bad'):
            self.declaration['nonce'] = nonce
            self.config['ax_witness'] = copy.deepcopy(self.declaration)
            with self.subTest(bound_invalid_nonce=nonce), self.assertRaises(RuntimeError): self.propose()
            self.assertFalse(self.output.exists())

    def test_nonempty_child_and_wrong_bound_owner_pid_are_denied(self):
        pending=self.port/'stale-request'
        pending.write_text('inert stale')
        with self.assertRaises(RuntimeError):self.propose()
        self.assertFalse(self.output.exists())
        pending.unlink()
        self.declaration['owner_pid']=os.getpid()+1
        self.config['ax_witness']=copy.deepcopy(self.declaration)
        with self.assertRaises(RuntimeError):self.propose()
        self.assertFalse(self.output.exists())

    def test_wrong_parent_and_path_prefix_alias_are_denied(self):
        wrong = self.folder / 'profiles-extra'
        wrong.mkdir()
        for parent in (wrong, self.folder):
            with self.subTest(parent=parent), self.assertRaises(RuntimeError):
                self.propose(profiles_root=parent)
        for path in (self.root, self.parent, Path(str(self.port)+'-extra'), self.root/'home with spaces'):
            with self.subTest(path=path):
                self.declaration['path'] = str(path / 'receipt.json')
                self.config['ax_witness'] = copy.deepcopy(self.declaration)
                with self.assertRaises(RuntimeError): self.propose()
                self.assertFalse(self.output.exists())

    def test_fixture_prefix_alias_is_denied(self):
        wrong = self.parent / 'nac342-xctest-configuredLocal-abc12345-extra'
        self.root.rename(wrong)
        self.profile['root'] = wrong
        self.declaration['path'] = str(wrong / 'ax-witness/receipt.json')
        self.config['ax_witness'] = copy.deepcopy(self.declaration)
        with self.assertRaises(RuntimeError): self.propose()
        self.assertFalse(self.output.exists())

    def test_linked_port_or_ancestor_denied(self):
        self.port.rmdir()
        target = self.folder / 'other'
        target.mkdir(mode=0o700)
        self.port.symlink_to(target, target_is_directory=True)
        with self.assertRaises(RuntimeError): self.propose()
        self.assertFalse(self.output.exists())
        self.port.unlink()
        self.port.mkdir(mode=0o700)
        alias = self.folder / 'profiles-link'
        alias.symlink_to(self.parent, target_is_directory=True)
        profile = dict(self.profile, root=alias/self.root.name)
        with self.assertRaises(RuntimeError):
            self.propose(profiles_root=alias, owned_profile=profile)
        self.assertFalse(self.output.exists())

    def test_nonprivate_modes_and_wrong_owner_denied(self):
        from unittest.mock import patch
        for path in (self.root, self.proof, self.port):
            path.chmod(0o755)
            with self.subTest(path=path), self.assertRaises(RuntimeError): self.propose()
            self.assertFalse(self.output.exists())
            path.chmod(0o700)
        with patch.object(os, 'getuid', return_value=os.getuid()+1):
            with self.assertRaises(RuntimeError): self.propose()
        self.assertFalse(self.output.exists())

    def test_nonconfigured_is_identical_and_cannot_acquire_grant(self):
        for scenario in ('onboarding', 'invalidConfig', 'futureStore', None):
            self.config = {} if scenario is None else dict(scenario=scenario)
            self.assertIs(self.propose(), self.selection)
            self.assertFalse(self.output.exists())
            self.config['ax_witness'] = self.declaration
            with self.assertRaises(RuntimeError): self.propose()
            self.assertFalse(self.output.exists())

    def test_config_digest_case_and_project_hash_fail_closed(self):
        with self.assertRaises(RuntimeError):
            m.private_request_selection(self.selection, b'{}', '0'*64, owned_profile=self.profile,
                profiles_root=self.parent, declaration=self.declaration, output=self.output)
        self.profile['scenario'] = 'onboarding'
        with self.assertRaises(RuntimeError): self.propose()
        self.profile['scenario'] = 'configuredLocal'
        self.selection['receipt']['generated_project_sha256'] = '0'*64
        with self.assertRaises(RuntimeError): self.propose()
        self.assertFalse(self.output.exists())

    def test_both_signatures_must_keep_full_baseline_with_only_exact_grant(self):
        base = {'com.apple.security.app-sandbox': True,
            'com.apple.security.temporary-exception.mach-lookup.local-name': ['com.apple.axserver'],
            'com.apple.security.temporary-exception.mach-lookup.global-name': ['com.apple.testmanagerd'],
            'com.apple.security.temporary-exception.sbpl': ['(allow hid-control)', '(allow signal)']}
        baseline = {'runner': dict(presence='present', entitlements=copy.deepcopy(base), mach_o_type=2),
                    'testbundle': dict(presence='absent', entitlements=None, mach_o_type=8)}
        actual = copy.deepcopy(baseline)
        actual['runner']['entitlements'][m.PRIVATE_PORT_WRITE] = [str(self.port)+'/']
        m.require_private_port_signatures(actual, baseline, self.port)
        for key in tuple(base) + (m.PRIVATE_PORT_WRITE,):
            bad = copy.deepcopy(actual)
            del bad['runner']['entitlements'][key]
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                m.require_private_port_signatures(bad, baseline, self.port)
        for path in (self.proof, self.root, self.parent, Path('/'), Path(str(self.port)+'-extra')):
            bad = copy.deepcopy(actual)
            bad['runner']['entitlements'][m.PRIVATE_PORT_WRITE] = [str(path)+'/']
            with self.assertRaises(RuntimeError): m.require_private_port_signatures(bad, baseline, self.port)
        for library in ({}, None, dict(presence='present',entitlements={},mach_o_type=8),
                        dict(presence='absent',entitlements=None,mach_o_type=2)):
            bad=copy.deepcopy(actual);bad['testbundle']=library
            with self.subTest(library=library),self.assertRaises(RuntimeError):
                m.require_private_port_signatures(bad,baseline,self.port)
        with self.assertRaises(RuntimeError):
            m.require_private_port_signatures({'runner': actual['runner']}, baseline, self.port)



import ci_startup_signatures as s


class PairTests(unittest.TestCase):
    # Reuse setup only; this class selects its own tests via explicit suite below.
    def setUp(self):
        PortProposalTests.setUp(self)
        self.calls = []
        self.commands = []
        self.mode = None
        self.marker = self.folder / 'configuration.json'
        self.marker.write_text(json.dumps(self.config))
        self.selection['receipt']['sources'] = {}
        for i in range(4):
            path = self.folder / ('source'+str(i)+'.swift')
            path.write_text('// inert source '+str(i)+'\n')
            self.selection['receipt']['sources'][str(path)] = m.digest(path.read_bytes())
        self.context = dict(profile=self.profile, profiles_root=self.parent, declaration=self.declaration)
        self.base = {'com.apple.security.app-sandbox': True,
            'com.apple.security.network.client': True,
            'com.apple.security.temporary-exception.files.absolute-path.read-only': ['/'],
            'com.apple.security.temporary-exception.mach-lookup.local-name': ['com.apple.axserver'],
            'com.apple.security.temporary-exception.mach-lookup.global-name': ['com.apple.testmanagerd','com.apple.dt.testmanagerd.runner'],
            'com.apple.security.temporary-exception.sbpl': ['(allow hid-control)','(allow signal)']}
        self.stack = self.enterContext(patch.dict(os.environ, {'DEVELOPER_DIR':'/inert/Xcode.app/Contents/Developer'}))

    def command(self,args):
        self.commands.append(args)
        if args[0] != '/usr/bin/codesign':
            return 'INERT toolchain '+str(args)
        product = Path(args[-1])
        if args[1] == '--verify':
            if self.mode == 'invalid-signature' or (self.mode == 'plugin-invalid-signature' and product.name.endswith('.xctest')):
                raise RuntimeError('inert verification failure')
            return ''
        candidate = 'normal-signature-baseline' not in str(product)
        if self.mode == 'display-failure' or (self.mode == 'plugin-display-failure' and product.name.endswith('.xctest')):
            raise RuntimeError('inert display failure')
        if self.mode == 'runner-absent' and product.name.endswith('.app'):
            return 'Executable='+str(product/'Contents/MacOS/NACStartupUITests-Runner')
        if product.name.endswith('.xctest'):
            if self.mode in ('library-payload-added','bundle-not-propagated') and candidate: return plistlib.dumps({'changed':True}).decode()
            if self.mode == 'library-empty-xml' and candidate: return plistlib.dumps({}).decode()
            if self.mode == 'library-baseline-present' and not candidate: return plistlib.dumps({}).decode()
            if self.mode == 'library-no-evidence': return ''
            if self.mode == 'library-wrong-executable': return 'Executable=/inert/wrong'
            return 'Executable='+str(product/'Contents/MacOS/NACStartupUITests')+'\n'
        values = copy.deepcopy(self.base)
        if self.mode == 'baseline-sbpl-string': values['com.apple.security.temporary-exception.sbpl']='(allow file-write*)'
        if self.mode == 'baseline-tab-default': values['com.apple.security.temporary-exception.sbpl']=['(allow\tdefault)']
        if self.mode == 'baseline-sbpl-element': values['com.apple.security.temporary-exception.sbpl']=[True,'(allow signal)']
        if self.mode == 'baseline-mach-string': values['com.apple.security.temporary-exception.mach-lookup.local-name']='com.apple.axserver'
        if self.mode == 'baseline-write': values['com.apple.security.temporary-exception.files.home-relative-path.read-write']=['/']
        if self.mode == 'baseline-filewrite': values['com.apple.security.temporary-exception.sbpl'].append('(allow file-write*)')
        if self.mode == 'baseline-sandbox-off': values['com.apple.security.app-sandbox']=False
        candidate = 'normal-signature-baseline' not in str(product)
        if candidate:
            values[m.PRIVATE_PORT_WRITE] = [str(self.port)+'/']
            if self.mode == 'candidate-bool-int': values['com.apple.security.network.client']=1
            if self.mode == 'missing-grant': del values[m.PRIVATE_PORT_WRITE]
            if self.mode == 'parent-grant': values[m.PRIVATE_PORT_WRITE] = [str(self.proof)+'/']
            if self.mode == 'prefix-grant': values[m.PRIVATE_PORT_WRITE] = [str(self.port)+'-extra/']
            if self.mode == 'sandbox-off': values['com.apple.security.app-sandbox'] = False
            if self.mode == 'drop-AX': del values['com.apple.security.temporary-exception.mach-lookup.local-name']
            if self.mode == 'drop-testmanager': values['com.apple.security.temporary-exception.mach-lookup.global-name'] = []
            if self.mode == 'extra-permission': values['com.apple.security.network.server'] = True
        elif self.mode == 'baseline-unavailable':
            return ''
        return plistlib.dumps(values).decode()

    def build(self,folder,config_path,config_hash,config,selection,run):
        self.calls.append((folder,selection))
        products = folder/'derived/Build/Products'
        host = products/'Debug/NACStartupUITests-Runner.app'
        bundle = host/'Contents/PlugIns/NACStartupUITests.xctest'
        for product,name in ((host,'NACStartupUITests-Runner'),(bundle,'NACStartupUITests')):
            (product/'Contents/MacOS').mkdir(parents=True)
            kind = 2 if product == host else 8
            if self.mode == 'library-main-executable' and product == bundle: kind=2
            binary=struct.pack('<IIIIIIII',0xFEEDFACF,0x0100000c,0,kind,0,0,0,0)+b'INERT-NOT-RUN'
            (product/'Contents/MacOS'/name).write_bytes(binary)
            package = 'APPL' if product == host else 'BNDL'
            if self.mode == 'library-wrong-package' and product == bundle: package='APPL'
            (product/'Contents/Info.plist').write_bytes(plistlib.dumps(dict(CFBundleExecutable=name,CFBundlePackageType=package)))
        runner = products/'actual.xctestrun'
        target = dict(IsUITestBundle=True,IsXCTRunnerHostedTestBundle=self.mode!='not-hosted',TestHostPath='__TESTROOT__/Debug/NACStartupUITests-Runner.app',
            TestBundlePath='__TESTHOST__/Contents/PlugIns/NACStartupUITests.xctest')
        runner.write_bytes(plistlib.dumps(dict(inert=target)))
        receipt = dict(generated_target=target,xctestrun_sha256=m.digest(runner.read_bytes()),selection=selection['receipt'])
        if self.mode == 'baseline-scheme-change' and len(self.calls) == 1:
            path=Path(selection['project'])/m.SCHEME.parent/(m.TARGETS[2]+'.xcscheme')
            path.write_bytes(path.read_bytes()+b'<!-- inert scheme mutation -->')
        if self.mode in ('candidate-scheme-change','candidate-ordinary-scheme-change') and len(self.calls) == 2:
            name=m.SCHEME.name if self.mode=='candidate-ordinary-scheme-change' else m.TARGETS[2]+'.xcscheme'
            path=Path(selection['project'])/m.SCHEME.parent/name
            path.write_bytes(path.read_bytes()+b'<!-- inert scheme mutation -->')
        if self.mode == 'candidate-prebuild-scheme-change' and len(self.calls) == 1:
            path=self.folder/'request-project'/m.PROJECT.name/m.SCHEME.parent/(m.TARGETS[2]+'.xcscheme')
            path.write_bytes(path.read_bytes()+b'<!-- inert prebuild mutation -->')
        if self.mode == 'source-change' and len(self.calls) == 1:
            Path(next(iter(selection['receipt']['sources']))).write_text('// changed')
        return runner,receipt

    def pair(self):
        return s.private_build_pair(self.folder,self.marker,m.digest(self.marker.read_bytes()),self.config,
            self.selection,None,self.command,self.context,self.build)

    def test_pair_real_wiring_builds_normal_baseline_first_and_gates_both_outputs(self):
        runner,receipt=self.pair()
        self.assertEqual(len(self.calls),2)
        self.assertIs(self.calls[0][1],self.selection)
        self.assertNotEqual(self.calls[1][1]['project'],self.selection['project'])
        gate=receipt['private_request_signature_gate']
        self.assertTrue(gate['both_actual_signatures_verified'])
        self.assertFalse(gate['acceptance'])
        self.assertEqual(gate['candidate']['testbundle']['entitlements_presence'],'absent')
        self.assertIsNone(gate['candidate']['testbundle']['entitlements'])
        self.assertEqual(set(gate['baseline']),{'runner','testbundle'})
        self.assertEqual(set(gate['candidate']),{'runner','testbundle'})
        self.assertEqual(sum(a[1]=='--verify' for a in self.commands if a[0]=='/usr/bin/codesign'),4)
        s.recheck_private_build(receipt,self.context)
        exe=Path(gate['candidate']['runner']['executable'])
        exe.write_bytes(b'CHANGED')
        with self.assertRaises(RuntimeError):s.recheck_private_build(receipt,self.context)

    def test_pair_each_adverse_signature_case_fails_without_returning_runner(self):
        # Isolate each case in a fresh owned fixture; no app/input operation exists.
        for mode in ('missing-grant','parent-grant','prefix-grant','sandbox-off','drop-AX','drop-testmanager',
                     'extra-permission','library-payload-added','bundle-not-propagated','library-empty-xml','library-baseline-present',
                     'library-no-evidence','library-wrong-executable','runner-absent','display-failure',
                     'baseline-unavailable','invalid-signature','source-change',
                     'baseline-write','baseline-filewrite','baseline-sandbox-off','baseline-sbpl-string',
                     'baseline-tab-default','baseline-sbpl-element','baseline-mach-string','candidate-bool-int',
                     'library-main-executable','library-wrong-package','not-hosted',
                     'plugin-invalid-signature','plugin-display-failure'):
            fixture=PairTests('test_pair_real_wiring_builds_normal_baseline_first_and_gates_both_outputs')
            fixture.setUp()
            try:
                fixture.mode=mode
                with self.subTest(mode=mode),self.assertRaises(RuntimeError):fixture.pair()
                self.assertFalse((fixture.folder/'private-request-signatures.json').exists())
            finally:fixture.doCleanups()

    def test_pair_rejected_permissions_retain_actual_false_observations(self):
        self.mode='missing-grant'
        with self.assertRaises(RuntimeError):self.pair()
        data=json.loads((self.folder/'private-request-signature-observations.json').read_text())
        self.assertIs(data['acceptance'],False)
        self.assertEqual(data['admission'],'NOT_ESTABLISHED')
        self.assertIsNone(data['baseline']['testbundle']['entitlements'])
        self.assertIsNone(data['candidate']['testbundle']['entitlements'])
        self.assertEqual(data['candidate']['testbundle']['entitlements_presence'],'absent')
        self.assertNotIn(m.PRIVATE_PORT_WRITE,data['candidate']['runner']['entitlements'])
        self.assertFalse((self.folder/'private-request-signatures.json').exists())

    def test_pair_changed_active_or_ordinary_scheme_cannot_return_runner(self):
        for mode in ('baseline-scheme-change','candidate-scheme-change','candidate-ordinary-scheme-change',
                     'candidate-prebuild-scheme-change'):
            fixture=PairTests('test_pair_real_wiring_builds_normal_baseline_first_and_gates_both_outputs')
            fixture.setUp()
            try:
                fixture.mode=mode
                with self.subTest(mode=mode),self.assertRaisesRegex(RuntimeError,'scheme'):
                    fixture.pair()
                self.assertFalse((fixture.folder/'private-request-signatures.json').exists())
            finally:fixture.doCleanups()

    def test_pair_missing_owner_or_observation_port_fails_before_build(self):
        for context,command in ((None,self.command),(self.context,None)):
            with self.assertRaises(RuntimeError):
                s.private_build_pair(self.folder,self.marker,m.digest(self.marker.read_bytes()),self.config,
                    self.selection,None,command,context,self.build)
        self.assertEqual(self.calls,[])

    def test_pair_directory_replacement_and_missing_admission_fail_before_input(self):
        _,receipt=self.pair()
        old=self.proof/'old-requests'
        self.port.rename(old)
        self.port.mkdir(mode=0o700)
        with self.assertRaises(RuntimeError):s.recheck_private_build(receipt,self.context)
        with self.assertRaises(RuntimeError):s.recheck_private_build({},self.context)

    def test_pair_actual_generated_runner_and_inspector_flow_with_inert_command_ports(self):
        import ci_startup
        source_name,source_hash=next(iter(self.selection['receipt']['sources'].items()))
        self.selection['receipt'].update(harness_sha='a'*40, startup_sha=ci_startup.TEST_SOURCE,
            startup_source_path=source_name,startup_source_sha256=source_hash)
        self.config['harness_sha']='a'*40
        self.marker.write_text(json.dumps(self.config))
        runs=[]
        def run(args,log,cap,*,env):
            self.assertEqual(args[:2],['xcodebuild','build-for-testing'])
            self.assertEqual(cap,240)
            self.assertFalse(any(arg.startswith(('CODE_SIGNING_ALLOWED=','CODE_SIGNING_REQUIRED=','ARCHS=','ONLY_ACTIVE_ARCH=')) for arg in args))
            project=Path(args[args.index('-project')+1])
            if project==self.project:
                selected=self.selection
            else:
                selected=dict(project=str(project),scheme=m.TARGETS[2],
                    receipt=json.loads((project.parent/'project-selection.json').read_text()))
            folder=log.parent
            runner,receipt=self.build(folder,self.marker,m.digest(self.marker.read_bytes()),self.config,selected,None)
            target=receipt['generated_target']
            target.update(IsUITestBundle=True,BlueprintName=m.TARGETS[2],
                EnvironmentVariables=dict(arg.split('=',1) for arg in args if arg.startswith('NAC_')))
            target['EnvironmentVariables'].update(NAC_STARTUP_SOURCE_PATH=source_name,NAC_STARTUP_SOURCE_SHA256=source_hash)
            runner.write_bytes(plistlib.dumps(dict(actual_inert_target=target)))
            log.write_text('INERT build port only; no compiler launched')
            runs.append(args)
        runner,receipt=ci_startup.generated_runner(self.folder,self.marker,m.digest(self.marker.read_bytes()),
            self.config,self.selection,run,private_request=self.context,command=self.command)
        self.assertEqual(len(runs),2)
        self.assertTrue(receipt['private_request_signature_gate']['both_actual_signatures_verified'])
        self.assertEqual(json.loads((self.folder/'runner.json').read_text()),json.loads(json.dumps(receipt)))
        self.assertEqual(receipt['generated_target']['EnvironmentVariables']['NAC_STARTUP_CONFIGURATION_SHA256'],m.digest(self.marker.read_bytes()))

    def test_pair_configured_wrapper_uses_pair_gate_and_nonconfigured_keeps_single_builder(self):
        import ci_startup
        receipt = {'inert': True}
        with patch.object(s, 'private_build_pair', return_value=(Path('/inert/runner'),receipt)) as pair:
            actual=ci_startup.generated_runner(self.folder,self.marker,m.digest(self.marker.read_bytes()),
                self.config,self.selection,None,private_request=self.context,command=self.command)
            self.assertEqual(actual,(Path('/inert/runner'),receipt))
            self.assertIs(pair.call_args.args[-2],self.context)
            self.assertIs(pair.call_args.args[-1],ci_startup._build_runner)
        for scenario in ('onboarding','invalidConfig','futureStore',None):
            config={} if scenario is None else dict(scenario=scenario)
            with patch.object(ci_startup,'_build_runner',return_value=('ordinary','unchanged')) as build:
                self.assertEqual(ci_startup.generated_runner(self.folder,self.marker,'inert',config,self.selection,None),
                                 ('ordinary','unchanged'))
                self.assertEqual(build.call_count,1)
            config['ax_witness']={}
            with self.assertRaises(RuntimeError):
                ci_startup.generated_runner(self.folder,self.marker,'inert',config,self.selection,None)

    def test_pair_xml_rejects_duplicates_nonxml_and_unexpected_prefix(self):
        exe=Path('/inert/exe')
        for text in ('', 'not XML', '<?xml version="1.0"?><plist><dict><key>x</key><true/><key>x</key><false/></dict></plist>',
                     'unexplained warning\n'+plistlib.dumps(self.base).decode()):
            with self.subTest(text=text[:30]),self.assertRaises((RuntimeError,ValueError)):
                s.decoded_entitlements(text,exe)
        text=plistlib.dumps(self.base).decode()
        self.assertEqual(s.decoded_entitlements('Executable=/inert/exe\n'+text,exe),self.base)





# Actual BuildOnly01 normal Runner payload; only its Executable path is replaced
# by an inert test path. Duplicated arrays are intentionally retained exactly.
NORMAL_RUNNER_XML = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.application-identifier</key><string>ai.arcee.nac.ci.startup-ui-tests.xctrunner</string><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.get-task-allow</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.temporary-exception.files.absolute-path.read-only</key><array><string>/</string><string>/</string></array><key>com.apple.security.temporary-exception.mach-lookup.global-name</key><array><string>com.apple.testmanagerd</string><string>com.apple.dt.testmanagerd.runner</string><string>com.apple.coresymbolicationd</string><string>com.apple.coredevice.version</string><string>com.apple.coredevice.service</string><string>com.apple.remoted</string><string>com.apple.testmanagerd</string><string>com.apple.dt.testmanagerd.runner</string><string>com.apple.coresymbolicationd</string></array><key>com.apple.security.temporary-exception.mach-lookup.local-name</key><array><string>com.apple.axserver</string></array><key>com.apple.security.temporary-exception.sbpl</key><array><string>(allow hid-control)</string><string>(allow signal)</string></array></dict></plist>\n'


class SignatureFormatTests(unittest.TestCase):
    def test_actual_normal_payload_is_typed_and_duplicate_arrays_survive(self):
        row=s.decoded_entitlements('Executable=/inert/runner\n'+NORMAL_RUNNER_XML,Path('/inert/runner'))
        self.assertIs(row['com.apple.security.app-sandbox'],True)
        self.assertEqual(row['com.apple.security.temporary-exception.files.absolute-path.read-only'],['/','/'])
        self.assertEqual(len(row['com.apple.security.temporary-exception.mach-lookup.global-name']),9)
        normal=dict(runner=dict(presence='present',entitlements=row,mach_o_type=2),
                    testbundle=dict(presence='absent',entitlements=None,mach_o_type=8))
        actual=copy.deepcopy(normal)
        actual['runner']['entitlements'][m.PRIVATE_PORT_WRITE]=['/inert/requests/']
        m.require_private_port_signatures(actual,normal,Path('/inert/requests'))
        actual['runner']['entitlements']['com.apple.security.temporary-exception.files.absolute-path.read-only']=['/']
        with self.assertRaises(RuntimeError):m.require_private_port_signatures(actual,normal,Path('/inert/requests'))

    def test_measured_missing_application_identifier_stays_rejected(self):
        row = s.decoded_entitlements(NORMAL_RUNNER_XML, Path('/inert/runner'))
        baseline = dict(runner=dict(presence='present', entitlements=row, mach_o_type=2),
                        testbundle=dict(presence='absent', entitlements=None, mach_o_type=8))
        candidate = copy.deepcopy(baseline)
        candidate['runner']['entitlements'][m.PRIVATE_PORT_WRITE] = ['/inert/requests/']
        m.require_private_port_signatures(candidate, baseline, Path('/inert/requests'))
        for value in (None, 'ai.arcee.nac.ci.another-ui-tests.xctrunner', True):
            bad = copy.deepcopy(candidate)
            if value is None:
                del bad['runner']['entitlements']['com.apple.application-identifier']
            else:
                bad['runner']['entitlements']['com.apple.application-identifier'] = value
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, 'entire typed baseline'):
                m.require_private_port_signatures(bad, baseline, Path('/inert/requests'))

    def test_actual_header_only_library_result_is_not_empty_xml_or_unknown(self):
        exe=Path('/inert/NACStartupUITests')
        for text in ('Executable='+str(exe),'Executable='+str(exe)+'\n'):
            self.assertIsNone(s.decoded_entitlements(text,exe,allow_absent=True))
            with self.assertRaises(RuntimeError):s.decoded_entitlements(text,exe)
        self.assertEqual(s.decoded_entitlements(plistlib.dumps({}).decode(),exe,allow_absent=True),{})
        for text in ('','Executable=/wrong','Executable='+str(exe)+'\nwarning','Executable='+str(exe)+'\n<?xml bad'):
            with self.subTest(text=text),self.assertRaises(Exception):s.decoded_entitlements(text,exe,allow_absent=True)

    def test_thin_headers_preserve_actual_role_kind_and_reject_truncation(self):
        for endian,magic,size in (('<',0xfeedfacf,32),('>',0xfeedfacf,32),('<',0xfeedface,28),('>',0xfeedface,28)):
            for kind in (2,8):
                data=struct.pack(endian+'IIIIIII',magic,0x0100000c,0,kind,0,0,0)+bytes(size-28)
                self.assertEqual(s.macho_type(data),kind)
                with self.assertRaises(RuntimeError):s.macho_type(data[:-1])
        for data in (b'',b'not Mach-O',bytes(32)):
            with self.assertRaises(RuntimeError):s.macho_type(data)

    def test_universal_all_slices_kinds_ranges_alignment_and_bounds(self):
        thin=lambda kind:struct.pack('<IIIIIIII',0xfeedfacf,0x0100000c,0,kind,0,0,0,0)
        def fat(kinds=(8,8),wide=False,offsets=None,alignment=0):
            stride=32 if wide else 20;count=len(kinds);end=8+count*stride
            starts=offsets or [end+32*i for i in range(count)]
            header=struct.pack('>II',0xcafebabf if wide else 0xcafebabe,count)
            for i,start in enumerate(starts):
                header+=struct.pack('>IIQQII' if wide else '>IIIII',0x0100000c+i,0,start,32,alignment,0) if wide else struct.pack('>IIIII',0x0100000c+i,0,start,32,alignment)
            return header+b''.join(thin(kind) for kind in kinds)
        for wide in (False,True):self.assertEqual(s.macho_type(fat(wide=wide)),8)
        for data in (fat((2,8)),fat()[:-1],fat(offsets=[48,48]),fat(offsets=[0,80]),fat(alignment=31),struct.pack('>II',0xcafebabe,9)):
            with self.subTest(case=data[:8]),self.assertRaises(RuntimeError):s.macho_type(data)

    def test_bare_none_or_synthetic_empty_library_cannot_supply_evidence(self):
        runner=s.decoded_entitlements(NORMAL_RUNNER_XML,Path('/inert/runner'))
        baseline=dict(runner=dict(presence='present',entitlements=runner,mach_o_type=2),
                      testbundle=dict(presence='absent',entitlements=None,mach_o_type=8))
        actual=copy.deepcopy(baseline)
        actual['runner']['entitlements'][m.PRIVATE_PORT_WRITE]=['/inert/requests/']
        for library in (None,{},dict(presence='absent',entitlements={},mach_o_type=8),
                        dict(presence='present',entitlements=None,mach_o_type=8)):
            bad=copy.deepcopy(actual);bad['testbundle']=library
            with self.subTest(library=library),self.assertRaises(RuntimeError):
                m.require_private_port_signatures(bad,baseline,Path('/inert/requests'))


if __name__ == '__main__': unittest.main(verbosity=2)
