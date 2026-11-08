"""New Q test identity, original unchanged P imports/cwd/artifact and cleanup."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lifecycle_capture.protocol import Client, P, read, digest, encoded, require, publish


def run(config_path,case,source,app,output,observer):
    from ci_qualifications import require_checkout
    from ci_paths_budget import Bound
    from lifecycle_capture.admission import admit,make_clock,verify_package
    from lifecycle_capture.controller import driver_command
    admission=admit();require_checkout(Path(source),P)
    harness=Path(__file__).resolve().parents[3];require_checkout(harness,admission['controller_sha'])
    session=read(config_path);config=dict(session['cases'][case],configuration_sha256=digest(Path(config_path).read_bytes()))
    require(config['case_root']==str(output) and config['Q_sha256']==digest(Path(__file__).with_name('q_driver.py').read_bytes()),'worker exact Q/output')
    require(os.environ['NAC_LIFECYCLE_SCENARIOS']==case,'single reserved scenario')
    control=Path(output).parent;ledger=read(control/'ledger.json');row=ledger['cases'][case]
    require(ledger['phase']=='case_dispatched' and ledger['active_case']==case and row['state']=='dispatched' and type(row['dispatches']) is int and row['dispatches']==1
        and row['execution']['source_sha']==P and row['execution']['harness_sha']==admission['controller_sha'] and row['output']==str(output)
        and ledger['capsule']==dict(admission,harness=admission['controller_sha'])
        and ledger['run_id']==os.environ['GITHUB_RUN_ID']
        and row['execution']['command']==driver_command(source,case,app,output,observer)
        and row['execution']['builds_sha256']==digest((control/'builds.json').read_bytes())
        and row['execution']['observer_sha256']==digest(Path(observer).read_bytes()),'matching durable worker reservation')
    builds=read(control/'builds.json')
    require(builds['app']==str(app) and builds['observer']==str(observer)
        and builds['capture_configuration_sha256']==config['configuration_sha256']
        and config['nonce']==digest(encoded([admission['admission_nonce'],case]))
        and config['P']==P and config['Q_sha256']==admission['Q_sha256']
        and config['helper_sha256']==builds['helper_sha256'],'exact package/configuration/Q paths')
    verify_package(Path(source),Path(app).parent)
    clock=make_clock(admission);client=Client(config,clock)
    sys.path.insert(0,str(Path(source)/'desktop/macos'))
    spec=importlib.util.spec_from_file_location('pinned_external_lifecycle_Q',Path(__file__).with_name('q_driver.py'))
    q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
    def interrupted(*args):raise KeyboardInterrupt('Owned capture driver interrupted')
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,interrupted)
    signal.pthread_sigmask(signal.SIG_UNBLOCK,{signal.SIGTERM,signal.SIGINT})
    os.umask(0o077) # Original journey creates only this owner's private output/profile directories.
    primary=None
    try:
        result=q.run_contract(app,output,observer,public_capture=client)
        require(client.next==3,'full two-phase Q prefix')
        return result
    except BaseException as error:
        primary=error;raise
    finally:
        try:publish(Path(output)/'provisional-fences.json',client.receipts)
        except BaseException as secondary:
            if primary is not None:
                if hasattr(primary,'add_note'):primary.add_note('Private capture-fence publication failed: '+type(secondary).__name__)
                raise primary from secondary
            raise


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='console':
        from lifecycle_capture.admission import admit
        from ci_qualifications import require_checkout
        value=admit();source=Path(sys.argv[2]);require_checkout(source,P)
        require_checkout(Path(__file__).resolve().parents[3],value['controller_sha'])
        sys.path.insert(0,str(source/'desktop/macos'))
        spec=importlib.util.spec_from_file_location('original_console_Q',Path(__file__).with_name('q_driver.py'))
        q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
        print(json.dumps(q.console_state()))
    else:
        require(len(sys.argv)==7,'fixed worker argument count')
        action,source,case,app,output,observer=sys.argv[1:]
        require(action=='driver','fixed worker action')
        run(Path(os.environ['NAC_CAPTURE_CASE_CONFIG']),case,Path(source),Path(app),Path(output),Path(observer))
