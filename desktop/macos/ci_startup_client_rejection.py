"""Private optional AX client-rejection ingestion; never startup acceptance."""
import json
import math
import os
import re
import stat
from ci_paths_budget import check as budget_check
from ci_xctest_attachments import digest

NAME='nac342-ax-client-rejection-v1-configuredLocal'
LIMIT=2048
TERMINALS={'application_timeout','windows_unavailable','root_matches','root_children','root_sheet_count',
           'panel_children','nested_sheet_count','owned_pid','foreign_window','incarnation_binding','focus_unavailable'}

class ClientRejectionError(RuntimeError):
    pass

def need(value, reason):
    if not value: raise ClientRejectionError(reason)

def validate(data, config, configuration_sha256, witness):
    need(type(data) is bytes and len(data)<=LIMIT,'client_size')
    def unique(pairs):
        need(len(pairs)==len(dict(pairs)),'client_duplicate'); return dict(pairs)
    row=json.loads(data,object_pairs_hook=unique,parse_constant=lambda _:need(False,'client_nonfinite'))
    expected={k:config[k] for k in ('source_sha','test_source_sha','harness_sha','startup_source_sha256')}
    expected.update({k:witness[k] for k in ('app_pid','app_launch_epoch','window_number')})
    expected.update(schema='nac342-ax-client-rejection-v1',acceptance=False,scenario='configuredLocal',
        gate='receipt_status_not_ready',configuration_sha256=configuration_sha256,
        helper_sha256=config['ax_witness']['helper_sha256'])
    counters={'sequence','refusal_generation','began_ns','ended_ns','case_deadline_ns'}
    fields=set(expected)|counters|{'guard_site','client_phase','receipt_status','refusal_stage','reader_terminal',
        'failure_payload_present','observation_present'}
    need(type(row) is dict and set(row)==fields,'client_fields')
    need(config['scenario']=='configuredLocal' and all(row[k]==v and type(row[k]) is type(v)
        for k,v in expected.items() if k!='app_launch_epoch'),'client_binding')
    need(type(row['app_launch_epoch']) in (int,float) and math.isfinite(row['app_launch_epoch'])
         and row['app_launch_epoch']>0 and row['app_launch_epoch']==witness['app_launch_epoch'],'client_incarnation')
    need(all(type(row[k]) is int and row[k]>0 for k in ('app_pid','window_number')),'client_identity')
    for k,width in [('source_sha',40),('test_source_sha',40),('harness_sha',40),('startup_source_sha256',64),
                    ('configuration_sha256',64),('helper_sha256',64)]:
        need(type(row[k]) is str and re.fullmatch('[0-9a-f]{'+str(width)+'}',row[k]),'client_hash')
    values={}
    for k in counters:
        value=row[k];need(type(value) is str and re.fullmatch(r'0|[1-9][0-9]{0,19}',value)
            and int(value)<2**64,'client_counter');values[k]=int(value)
    need(values['sequence']>0 and values['began_ns']<=values['ended_ns']<values['case_deadline_ns'],'client_interval')
    for k,allowed in [('guard_site',{'initial_guard','later_guard'}),('client_phase',{'begin','consume'}),
                     ('receipt_status',{'refused','retiring','retired','other'}),
                     ('refusal_stage',{'ax_predicate_refused','sample_deadline','target_retiring','target_retired','absent','other'}),
                     ('reader_terminal',TERMINALS|{'absent','other'})]:
        need(type(row[k]) is str and row[k] in allowed,'client_enum')
    need(all(type(row[k]) is bool for k in ('failure_payload_present','observation_present')),'client_bool')
    need(row['failure_payload_present'] or row['reader_terminal']=='absent','client_payload')
    return row

def _read_record(path):
    budget_check()
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(descriptor,'rb') as stream:
        info=os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and 0<info.st_size<=LIMIT,'client_file')
        data=stream.read(LIMIT+1)
        need(len(data)==info.st_size and len(data)<=LIMIT,'client_file_changed')
    budget_check()
    return data

def retain(selected,entries,index,config,configuration_sha256,witness,output,inventory_valid):
    record=index['client_rejection']
    if not any(isinstance(x,dict) and isinstance(x.get('suggestedHumanReadableName'),str)
        and x['suggestedHumanReadableName'].startswith('nac342-ax-client-rejection-') for x in entries):return 0
    record.update(retention='rejected',reason='client_inventory')
    files=[f for f,_,kind in selected if kind=='client_rejection']
    if len(files)!=1 or not inventory_valid or index['selection_errors']:return 0
    destination=output/(NAME+'.json');created=False
    try:
        need(index['actual_test']['result']=='Failed','client_failure_only')
        data=_read_record(files[0]);validate(data,config,configuration_sha256,witness)
        descriptor=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);created=True
        with os.fdopen(descriptor,'wb') as stream:need(stream.write(data)==len(data),'client_partial')
        record.clear();record.update(retention='retained',file=destination.name,bytes=len(data),sha256=digest(data))
        return len(data)
    except BaseException as error:
        record['reason']=str(error) if isinstance(error,ClientRejectionError) else 'client_unavailable_or_invalid'
        if created:
            try:destination.unlink(missing_ok=True)
            except OSError:pass
        return 0
