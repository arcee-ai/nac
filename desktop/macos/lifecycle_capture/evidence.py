"""Original42MiB lifecycle export plus <=12MiB six-screen supplement; metadata in12."""
import json
import os
from pathlib import Path
from .protocol import CASES, PNG_MAX, SUPPLEMENT_MAX, TOTAL_MAX, digest, encoded, require


def capacity():
    from ci_lifecycle_evidence import capacity as original
    base=original()
    require(base['total']+SUPPLEMENT_MAX==TOTAL_MAX,'explicit54MiB combined envelope')
    return dict(original=base,supplement_png_paths=[f'screens/{case}/{i}.png' for case in CASES for i in (1,2)],
        supplement_png_each=PNG_MAX,supplement_png_total=SUPPLEMENT_MAX,total=TOTAL_MAX,
        supplement_metadata='charged INSIDE original12MiB non-image/index budget; no extra envelope',
        full_compiler_log='critical complete JSON under original12MiB; overflow fails, no log-tail-only proof')


def roster():
    return dict(product_app_engine_observer_rebuilds=0,Rust=0,
        direct_Swift=[dict(role='external-read-only-AX-witness',inputs=['LifecycleCaptureWitness.swift','CapturePort.swift'],builds=1,cap_seconds=90),
                      dict(role='original-image-reader',inputs=['CILifecycleImages.swift'],builds=1,cap_seconds=90)],
        SDK_builds=1,SDK_named_Swift_inputs=['LifecycleCaptureJourneys.swift','CapturePort.swift'],
        SDK_generated_inputs='Xcode-owned runner/module glue; full actual build log retained; no claim of a one-file compiler graph',
        SDK_build_cap=240,XCTest_actors=dict(count=3,each_cap=350,selected_tests=3),
        AX_witness_actors=dict(count=3,each_cap=350),Q_drivers=dict(count=3,each_cap=240),
        original_native_diagnostic_images=15,new_uncropped_main_screen_images=6,new_clicks=0,new_keys=0,
        image_reader_calls=dict(count=15,each_cap=10),
        concurrency='ready5 + concurrent max(Q240, SDK350/witness350) + collection45 + runner5 + witness25 + margin10 =440; cleanup300; admission740',
        cleanup='original driver150+forced-handle5, SDK owner45, external witness25, coordinator5, final export60 =290 <=300; independent owners, original cutoffs',
        holds=dict(first_seconds=60,second_seconds=90,inside_original_driver240=True),
        source_only=True,actual_admission_required=True)


def plan_screens(auxiliary,*,complete):
    rows=[];total=0
    for case in CASES:
        for ordinal in (1,2):
            path=auxiliary/(case+'-screens')/f'{ordinal}.png'
            if not path.exists():
                require(not complete,'missing required composited frame');continue
            require(path.resolve()==path and not path.is_symlink() and path.is_file()
                and path.stat().st_nlink==1 and 0<path.stat().st_size<=PNG_MAX,'bounded original screen')
            data=path.read_bytes();require(data.startswith(b'\x89PNG\r\n\x1a\n'),'PNG signature')
            total+=len(data);rows.append((Path('screens')/case/path.name,data))
    require(total<=SUPPLEMENT_MAX and (not complete or len(rows)==6),'six-screen12MiB supplement')
    return rows


def finalize(raw,auxiliary,output,report,replacements):
    from ci_lifecycle_finalization import finalize as original
    from .transaction.contract import persist
    require(not output.exists(),'fresh combined export')
    screens=plan_screens(auxiliary,complete=report['result']=='passed')
    # These are the complete actual selected actor/SDK owner logs; critical JSON
    # makes the original exporter split complete bytes instead of clipping tails.
    for case in CASES:
        folder=auxiliary/case
        for name in ('test.log','witness.log'):
            path=folder/name
            if not path.exists():continue
            require(path.resolve()==path and not path.is_symlink() and path.stat().st_size<=512*1024,'complete actor log limit')
            owner=Path(str(path)+'.ownership.json')
            persist(raw/f'capture-{case}-{name}.json',dict(text=path.read_text(),owner=json.loads(owner.read_bytes()) if owner.exists() else None))
    for name in ('xctest-attachment-tool.json','xctest-attachment-tool-identity.json'):
        path=auxiliary/'tool'/name
        if path.exists():
            require(not path.is_symlink() and path.stat().st_size<=256*1024,'tool provenance limit')
            persist(raw/name,json.loads(path.read_bytes()))
    envelope=dict(capacity=capacity(),supplement=[dict(file=str(p),bytes=len(data),sha256=digest(data)) for p,data in screens],
        structural_capture_complete=report.get('structural_capture_complete') is True,
        composited_paint_acceptance=False,manual_visual_review_required=True,trusted_input_acceptance=False)
    require(len(encoded(envelope))<=64*1024,'combined index charged inside old metadata')
    persist(raw/'capture-envelope.json',envelope)
    stage=output.with_name(output.name+'.staging');require(not stage.exists(),'no staging reentry');stage.mkdir(mode=0o700)
    try:
        original(raw,stage/'base',report,replacements)
        for relative,data in screens:
            path=stage/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        total=sum(p.stat().st_size for p in stage.rglob('*') if p.is_file())
        require(total<=TOTAL_MAX,'actual final combined54MiB export cap')
        os.rename(stage,output)
    except BaseException:
        report['result']='failed';report['structural_capture_complete']=False
        persist(raw/'ci-report.json',report)
        raise # Preserve staged/raw partials; never publish a passing subset.
