"""One finite offline-prepared P12 capture episode. No dispatch, download or merge."""
import functools
import json
import os
from pathlib import Path
import platform
import plistlib
import signal
import sys
from .admission import admit, make_clock, verify_package, BASE, STOP
from .protocol import CASES, CASE_ALLOWANCE, P, digest, encoded, private, publish, read, require
from .transaction import contract, ownership, supervisor
from .owners import Task

ROOT=Path(__file__).resolve().parents[3]


def driver_command(source,name,app,output,observer):
    return [sys.executable,'-B',str(Path(__file__).with_name('worker.py')),'driver',str(source),name,str(app),str(output),str(observer)]


def episode(source,package,output):
    from ci_paths_budget import using
    from ci_qualifications import require_checkout
    from ci_lifecycle_evidence import capacity,export_plan,images,FINAL_METADATA_BYTES
    from ci_lifecycle_finalization import prepare,result_guard,ledger_guard
    from ci_support import redact_values,qualify_toolchain
    from ci_xctest import runner_environment,authorization_policy,observe_prerequisites
    from ci_xctest_attachments import AttachmentTool
    from . import materialize,collector,evidence
    from .capture_case import Capture,driver_with_capture
    import ci
    value=admit();clock=make_clock(value);ci.RUN_DEADLINE=clock.cleanup.deadline
    require(platform.system()=='Darwin' and platform.machine()=='arm64','reviewed actual arm64 macOS host')
    for path in (source,package):contract.canonical(path)
    contract.canonical(output,exists=False)
    require(not output.exists() and all(a!=b and not a.is_relative_to(b) for a in (ROOT,source,package,output) for b in (ROOT,source,package,output) if a is not b),'disjoint canonical inputs/output')
    os.umask(0o077);output.mkdir(mode=0o700)
    raw=output/'raw';raw.mkdir(mode=0o700);control=raw/'lifecycle';control.mkdir(mode=0o700)
    auxiliary=output/'capture';auxiliary.mkdir(mode=0o700)
    report=dict(result='failed',scope=value['scope'],admission=value,compiler_roles=evidence.roster(),cases=[],
        lifecycle_transactions_accepted=False,structural_capture_complete=False,composited_paint_acceptance=False,
        trusted_input_acceptance=False,full_G3_accepted=False,minimum_os_qualified=False,signature_qualified=False)
    replacements=[*redact_values(),(str(ROOT),'<capture-source>'),(str(source),'<product-source>')]
    ledger=None;counter=0;primary=None;completed=[]

    def run(argv,log,cap,*,limit=512*1024):
        clock.require_phase('helper-'+Path(argv[0]).name,cap+15)
        task=Task(argv,log,cap,clock,env=runner_environment(),limit=limit).start()
        try:proof=task.finish(cap+20)
        except BaseException as error:
            try:task.cancel(25)
            except BaseException as secondary:
                if hasattr(error,'add_note'):error.add_note('helper cleanup: '+type(secondary).__name__)
            raise
        # H's old exporter truncates logs; preserve complete bounded compiler
        # graph/tool output in critical JSON too, charged to its original12MiB.
        contract.persist(Path(str(log)+'.complete.json'),dict(text=log.read_text(),owner=proof))
        return proof
    def command(argv):
        nonlocal counter
        counter+=1;log=raw/f'command-{counter}.log'
        run(argv,log,15,limit=256*1024);return log.read_text().strip()
    def guards():
        admit(value);require_checkout(ROOT,value['controller_sha']);require_checkout(source,P)
        require(command(['git','-C',str(ROOT),'rev-parse','HEAD^'])==BASE,'one exact reviewed H child')
        return verify_package(source,package)
    def console():
        log=raw/f'console-{len(completed)}.log'
        run([sys.executable,'-B',str(Path(__file__).with_name('worker.py')),'console',str(source)],log,15)
        result=json.loads(log.read_bytes());contract.require_console(result);return result
    try:
        with using(clock.work):
            guards();body=read(package/'manifest.json');app=package/body['bundle']['name'];observer=package/body['observer']['name']
            expected=read(ROOT/'desktop/macos/ci-toolchain.json')
            actual=dict(image=os.environ.get('ImageVersion'),developer_directory=os.environ.get('DEVELOPER_DIR'),
                xcode=command(['xcodebuild','-version']),sdk=command(['xcrun','--sdk','macosx','--show-sdk-version']),
                os_version=command(['/usr/bin/sw_vers','-productVersion']),os_build=command(['/usr/bin/sw_vers','-buildVersion']),
                swift=command(['xcrun','swiftc','--version']))
            qualify_toolchain(actual,expected);report['toolchain']=actual
            policy=authorization_policy(observe_prerequisites(command));report['authorization_policy_sha256']=digest(encoded(policy))
            report['console_preflight']=console()
            builds=dict(app=str(app),observer=str(observer),manifest_sha256=value['manifest_sha256'],
                observer_sha256=digest(observer.read_bytes()),lifecycle_build=body['native_build_receipt'],export_capacity=evidence.capacity())
            contract.persist(control/'builds.json',builds)
            helper=output/'capture-witness';image_reader=output/'lifecycle-image-reader'
            inputs=Path(__file__).parent
            run(['xcrun','swiftc','-swift-version','5',str(inputs/'LifecycleCaptureWitness.swift'),str(inputs/'CapturePort.swift'),'-o',str(helper)],raw/'witness-build.log',90,limit=64*1024)
            run(['xcrun','swiftc','-swift-version','5',str(ROOT/'desktop/macos/CILifecycleImages.swift'),'-o',str(image_reader)],raw/'image-build.log',90,limit=64*1024)
            helper_hash=digest(helper.read_bytes());image_hash=digest(image_reader.read_bytes())
            session=output/'session.json';cases={}
            for name in CASES:
                port=auxiliary/(name+'-port');port.mkdir(mode=0o700)
                cases[name]=dict(case=name,port=str(port),case_root=str(control/name),P=P,Q_sha256=value['Q_sha256'],
                    nonce=digest(encoded([value['admission_nonce'],name])),deadline_ns=str(int(clock.work.deadline*1e9)),
                    bundle_id=body['native_build_receipt']['bundle_identifier'],native_sha256=body['native_build_receipt']['native_sha256'],
                    engine_sha256=body['native_build_receipt']['engine_sha256'],helper_sha256=helper_hash)
            publish(session,dict(schema='lifecycle-capture-session-v1',cases=cases))
            config_hash=digest(session.read_bytes())
            builds.update(capture_configuration_sha256=config_hash,Q_sha256=value['Q_sha256'],helper_sha256=helper_hash)
            contract.persist(control/'builds.json',builds)
            selection=materialize.materialize(ROOT,output/'project')
            derived=output/'derived'
            run(['xcodebuild','build-for-testing','-project',selection['project'],'-scheme',selection['scheme'],
                '-destination','platform=macOS,arch=arm64','-derivedDataPath',str(derived),'-parallel-testing-enabled','NO',
                'NAC_UI_FIXTURE='+str(session)],raw/'SDK-build.log',240,limit=2*1024**2)
            runners=list((derived/'Build/Products').glob('*.xctestrun'));require(len(runners)==1,'one actual generated runner')
            runner=runners[0];runner_hash=digest(runner.read_bytes())
            target=materialize.runner(plistlib.loads(runner.read_bytes()),session,selection)
            contract.persist(raw/'SDK-runner.json',dict(selection=selection,target=target,xctestrun_sha256=runner_hash,configuration_sha256=config_hash))
            tools=auxiliary/'tool';tools.mkdir(mode=0o700);tool=AttachmentTool(tools,command).prepare()
            contract.persist(control/'finalization-contract.json',prepare(report,builds,replacements))
            export_plan(raw,replacements,completed=(),reserve=FINAL_METADATA_BYTES)
            ledger=contract.Ledger(control,dict(value,harness=value['controller_sha']),os.environ['GITHUB_RUN_ID'],binding=contract.Binding.P12)
        owner=type('OriginalP12Owner',(),dict(retain=staticmethod(functools.partial(ownership.retain,binding=contract.Binding.P12)),require=staticmethod(functools.partial(ownership.require,binding=contract.Binding.P12))))
        for name in CASES:
            clock.require_phase('case-'+name,CASE_ALLOWANCE)
            with using(clock.work):
                guards();observed=console()
                require(digest(helper.read_bytes())==helper_hash and digest(image_reader.read_bytes())==image_hash,'compiled closure unchanged')
                materialize.runner(plistlib.loads(runner.read_bytes()),session,selection)
                require(digest(session.read_bytes())==config_hash and digest(runner.read_bytes())==runner_hash,'immutable session/runner')
                destination=control/name;argv=driver_command(source,name,app,destination,observer)
                execution=dict(source_sha=P,harness_sha=value['controller_sha'],builds_sha256=digest((control/'builds.json').read_bytes()),observer_sha256=digest(observer.read_bytes()),command=argv)
                clock.require_phase('durable-reservation-'+name,CASE_ALLOWANCE)
                ledger.reserve(name,destination,observed,execution)
            outcome=dict(case=name,status='unknown');case_error=None
            try:
                with using(clock.work):
                    clock.require_phase('dispatch-'+name,CASE_ALLOWANCE)
                    env=dict(runner_environment(),NAC_LIFECYCLE_SOURCE=str(source),NAC_LIFECYCLE_SCENARIOS=name,NAC_CAPTURE_CASE_CONFIG=str(session))
                    folder=auxiliary/name;folder.mkdir(mode=0o700)
                    config=dict(cases[name],configuration_sha256=config_hash)
                    capture=Capture(config,session,runner,runner_hash,helper,folder,clock,env,tool,command)
                    outcome['driver']=driver_with_capture(capture,argv,destination/'runner.log',env,owner,clock)
                    summary=read(destination/'summary.json')
                    assets={k:v['sha256'] for k,v in body['source']['assets']['files'].items()}
                    proof=contract.require_case(summary,name,body['native_build_receipt'],assets,binding=contract.Binding.P12)
                    owner.require(destination,name,proof['native'])
                    found,test,public=capture.collected
                    fences=read(destination/'provisional-fences.json')
                    frames=collector.join(config,capture.requests,fences,found,origin=test)
                    screen_folder=auxiliary/(name+'-screens');screen_folder.mkdir(mode=0o700)
                    for ordinal in (1,2):
                        (screen_folder/f'{ordinal}.png').write_bytes(found[(ordinal,'screen')])
                        contract.persist(destination/f'caption-{ordinal}.json',json.loads(found[(ordinal,'caption')]))
                    contract.persist(destination/'capture-result.json',dict(public=public,frames=frames,settlement=capture.settlement))
                    def native_report(args,log):
                        clock.require_phase('original-image-read',25)
                        return supervisor.image_report(args,log,cwd=ROOT)
                    outcome.update(status='passed',original_images=images(destination,name,image_reader,native_report,raw),frames=frames)
            except BaseException as error:case_error=error;outcome.update(status='unknown',error_type=type(error).__name__)
            finally:
                try:
                    with using(clock.cleanup):
                        outcome['cleanup']=supervisor.audit_cleanup(destination,observer,supervisor.read_residual,owner=owner)
                    require(outcome['cleanup']['complete'] is True,'positive app/engine/provider/descendant cleanup')
                    require(outcome['status']!='passed' or not outcome['cleanup']['retained_failure_roots'],'passing case retained profile')
                except BaseException as error:
                    outcome.update(status='unknown',cleanup_error=type(error).__name__)
                    if case_error is None:case_error=error
                    elif hasattr(case_error,'add_note'):case_error.add_note('native cleanup: '+type(error).__name__)
            try:
                contract.persist(destination/'external-result.json',outcome);result_guard(raw,destination/'external-result.json',replacements)
                ledger.finish(name,outcome['status'],{'external_result_sha256':digest((destination/'external-result.json').read_bytes())},before_save=lambda v:ledger_guard(v,replacements))
                completed.append(name);report['cases'].append(outcome)
            except BaseException as error:
                if case_error is not None:raise case_error from error
                raise
            if case_error is not None:raise case_error
            clock.work.check()
        with using(clock.work):
            require(authorization_policy(observe_prerequisites(command))==policy,'persistent authorization policy changed')
            ledger.value['phase']='complete';ledger.save();clock.work.check()
            report.update(result='passed',lifecycle_transactions_accepted=True,structural_capture_complete=True)
    except BaseException as error:
        primary=error;clock.fail('capture episode failed or unknown');report.update(error_type=type(error).__name__,error=str(error)[:2048])
    finally:
        if ledger is not None:
            try:ledger.close()
            except BaseException as error:
                if primary is None:primary=error;report['result']='failed'
                elif hasattr(primary,'add_note'):primary.add_note('Ledger lock close: '+type(error).__name__)
        try:
            with using(clock.retention):evidence.finalize(raw,auxiliary,output/'evidence',report,replacements)
        except BaseException as error:
            if primary is not None:
                if hasattr(primary,'add_note'):primary.add_note('capture export failed: '+type(error).__name__)
            else:primary=error
    if primary is not None:raise primary
    return report


if __name__=='__main__':
    require(len(sys.argv)==4,'fixed source/package/absent-output arguments')
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda n,f:STOP.append(n))
    episode(*map(Path,sys.argv[1:]))
