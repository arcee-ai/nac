"""Exact selected XCTest origin and two original PNG/caption pairs per case."""
import json
import math
import re
from pathlib import Path
from .protocol import decoded, raw, TESTS, PHASES, PNG_MAX, closed, digest, encoded, require, require_request, release


def selected_test(tree,case):
    TEST=TESTS[case]
    def walk(v):
        if isinstance(v,dict):
            if v.get('nodeType')=='Test Case':yield v
            for x in v.values():yield from walk(x)
        elif isinstance(v,list):
            for x in v:yield from walk(x)
    tests=list(walk(tree));require(len(tests)==1,'one actual selected test')
    test=tests[0];require(test.get('nodeIdentifierURL')==TEST and test.get('result')=='Passed'
        and type(test.get('nodeIdentifier')) is str,'exact successful lifecycle test URI')
    return test


def pairs(folder,manifest,tree,case):
    TEST=TESTS[case]
    test=selected_test(tree,case);require(type(manifest) is list and len(manifest)==1,'one test group')
    group=manifest[0];require(group.get('testIdentifier')==test['nodeIdentifier']
        and group.get('testIdentifierURL',TEST)==TEST,'actual test attachment origin')
    entries=group.get('attachments');require(type(entries) is list and len(entries)<=64,'entry cap')
    found={};files=set()
    for e in entries:
        name=e.get('suggestedHumanReadableName');leaf=e.get('exportedFileName')
        require(type(name) is str and type(leaf) is str and Path(leaf).name==leaf
            and leaf not in files and leaf not in ('.','..') and '\\' not in leaf,'safe unique leaf')
        files.add(leaf)
        match=re.fullmatch(r'lifecycle-(screen|caption)-([12])(?:_\d+_[0-9A-Fa-f-]{36})?(?:\.(png|json))?',name)
        if not match:
            require(not name.startswith('lifecycle-'),'foreign lifecycle primary');continue
        key=(int(match[2]),match[1]);require(key not in found,'duplicate frame/type')
        f=Path(folder)/leaf;limit=PNG_MAX if key[1]=='screen' else 64*1024
        require(not f.is_symlink() and f.is_file() and f.stat().st_nlink==1 and f.stat().st_size<=limit,'regular bounded unique file')
        found[key]=raw(f,limit)
    require(set(found)=={(i,k) for i in (1,2) for k in ('screen','caption')},'complete primary pairs')
    return found,test


def public_join(config,requests,found,*,origin):
    TEST=TESTS[config['case']]
    require(origin['nodeIdentifierURL']==TEST and origin['result']=='Passed','actual origin')
    require(len(requests)==2,'full request prefix')
    result=[];total=0
    for ordinal in (1,2):
        req=require_request(requests[ordinal-1],config,ordinal)
        png=found[(ordinal,'screen')];meta=decoded(found[(ordinal,'caption')])
        closed(meta,('schema','ordinal','configuration_sha256','nonce','request_sha256','before','after',
            'png_sha256','png_bytes','capture_method','new_input_actions','manual_visual_acceptance','runner','capture_began_ns','capture_ended_ns'))
        require(png.startswith(b'\x89PNG\r\n\x1a\n') and 0<len(png)<=PNG_MAX,'raw bounded PNG')
        require(type(meta['ordinal']) is int and meta['ordinal']==ordinal and meta['schema']=='lifecycle-screen-v1'
            and meta['configuration_sha256']==config['configuration_sha256'] and meta['nonce']==config['nonce']
            and meta['request_sha256']==digest(encoded(req)) and meta['png_sha256']==digest(png)
            and type(meta['png_bytes']) is int and meta['png_bytes']==len(png)
            and meta['capture_method']=='public-XCTest-main-screen' and type(meta['new_input_actions']) is int
            and meta['new_input_actions']==0 and meta['manual_visual_acceptance'] is False,'public byte/source/no-input binding')
        require(all(type(meta[k]) is str and re.fullmatch('0|[1-9][0-9]{0,19}',meta[k]) and int(meta[k])<2**64 for k in ('capture_began_ns','capture_ended_ns')),'canonical capture counters')
        require(0<int(meta['capture_ended_ns'])-int(meta['capture_began_ns'])<=10*10**9,'bounded capture interval')
        before,after=meta['before'],meta['after']
        require(int(before['ended_ns'])<=int(meta['capture_began_ns'])<int(meta['capture_ended_ns'])<=int(after['began_ns']),'capture bracketed by independent samples')
        for proof in (before,after):
            require(proof['schema']=='lifecycle-proof-v1' and proof['status']=='ready'
                and proof['nonce']==config['nonce'] and proof['configuration_sha256']==config['configuration_sha256']
                and proof['request_sha256']==digest(encoded(req)) and type(proof['ordinal']) is int and proof['ordinal']==ordinal
                and proof['owner']==req['binding'] and proof['app_path']==req['app_path'],'witness to request')
            for k in ('began_ns','ended_ns','sequence'):
                require(type(proof[k]) is str and re.fullmatch('0|[1-9][0-9]{0,19}',proof[k]) and int(proof[k])<2**64,'canonical sample counter')
            for k in ('root_frame','sheet_frame','cancel_frame','stop_frame','screen_frame'):
                frame=proof[k]
                require(type(frame) is list and len(frame)==4 and all(type(n) in (int,float) and math.isfinite(n) for n in frame)
                    and frame[2]>0 and frame[3]>0,'finite positive frame')
            for k in ('helper_token','root_token','sheet_token','cancel_token','stop_token'):
                require(type(proof[k]) is str and 0<len(proof[k])<=128,'bounded opaque owner token')
            birth=proof['engine_birth']
            require(type(birth) is list and len(birth)==3 and all(type(n) is int for n in birth)
                and birth[0]==req['binding']['engine_pid'] and birth[1]>0 and 0<=birth[2]<1000000,'exact engine generation')
            require(type(proof['app_launch_epoch']) in (int,float) and math.isfinite(proof['app_launch_epoch'])
                and proof['app_launch_epoch']>0,'actual app birth')
            require(0<=int(proof['ended_ns'])-int(proof['began_ns'])<=10**9,'sample cap')
        require(int(after['began_ns'])>int(before['ended_ns']) and int(after['sequence'])>int(before['sequence']), 'ordered fresh samples')
        for key in ('helper_token','root_token','sheet_token','cancel_token','stop_token','owner','root_frame',
                    'sheet_frame','cancel_frame','stop_frame','screen_frame','engine_birth','app_launch_epoch'):
            require(before[key]==after[key],'same owners/geometry across screenshot')
        require(before['helper_token']==config['helper_token'],'H-verified witness identity')
        if ordinal==2:
            first=requests[0]['binding']
            for k in ('app_pid','engine_pid','workspace_window_number','launch_incarnation','ready_store','document'):
                require(req['binding'][k]==first[k],'same native owners across confirmations')
            require(req['binding']['confirmation_id']!=first['confirmation_id'],'distinct second confirmation')
            first_meta=json.loads(found[(1,'caption')])
            for k in ('helper_token','root_token','engine_birth','app_launch_epoch'):
                require(before[k]==first_meta['before'][k],'same external owners across confirmations')
            require(before['sheet_token']!=first_meta['before']['sheet_token'],'distinct second sheet')
        total+=len(png);require(total<=4*1024**2,'case image envelope')
        result.append(dict(case=config['case'],ordinal=ordinal,phase=PHASES[ordinal-1],png_sha256=digest(png),
            png_bytes=len(png),metadata_sha256=digest(found[(ordinal,'caption')]),actual_test_uri=TEST,
            public_collection_complete=True,actual_pixel_review_required=True,composited_acceptance=False,
            trusted_or_physical_input=False))
    return result


def join(config,requests,fences,found,*,origin):
    require(len(fences)==2,'full real private prefix')
    for req,fence in zip(requests,fences):
        require(fence['request']==req and fence['release']==release(req)
            and fence['before']==fence['after']==req['binding'],'exact private provisional fence')
    result=public_join(config,requests,found,origin=origin)
    return [dict(row,structural_capture_complete=True) for row in result]


def collect_public(result,folder,config,requests,command,*,tool=None):
    from ci_xctest_attachments import AttachmentTool
    from ci_xctest import result_receipt
    tool=tool or AttachmentTool(Path(folder),command).prepare()
    tree_bytes=tool.capture([tool.path,'get','test-results','tests','--path',str(result)],'lifecycle-actual-tests',retain=False)
    TEST=TESTS[config['case']]
    tree=json.loads(tree_bytes);selected_test(tree,config['case'])
    export=Path(folder)/'selected-export';require(not export.exists(),'fresh selected export')
    tool.capture([tool.path,'export','attachments','--path',str(result),'--test-id',TEST,'--output-path',str(export)],'lifecycle-export',retain=False)
    manifest=json.loads((export/'manifest.json').read_bytes());found,test=pairs(export,manifest,tree,config['case'])
    proofs=public_join(config,requests,found,origin=test)
    receipt=dict(actual_test=test,result_bundle=result_receipt(Path(result)),actual_test_tree_sha256=digest(tree_bytes),frames=proofs)
    return found,test,receipt
