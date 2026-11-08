"""A finite lifecycle UI-test target from H's exact maintained project."""
from pathlib import Path
from ci_xctest_project import PROJECT,SCHEME,NATIVE,PROJECT_HASH,SCHEME_HASH,source_file,source_variant
from .protocol import require,digest
TARGET='NACLifecycleCaptureUITests'


def materialize(harness,output):
    harness,output=Path(harness),Path(output)
    require(harness.is_absolute() and harness.resolve()==harness and output.is_absolute()
        and output.resolve()==output and not output.exists() and not output.is_relative_to(harness),'isolated project')
    _,base=source_file(harness,PROJECT/'project.pbxproj');_,scheme=source_file(harness,PROJECT/SCHEME)
    native,_=source_file(harness,NATIVE)
    require(digest(base)==PROJECT_HASH and digest(scheme)==SCHEME_HASH,'maintained project/scheme pin')
    source=harness/'desktop/macos/lifecycle_capture/LifecycleCaptureJourneys.swift'
    support=harness/'desktop/macos/lifecycle_capture/CapturePort.swift'
    files={str(source):digest(source.read_bytes()),str(support):digest(support.read_bytes())}
    data=source_variant(base,native,source,files[str(source)],TARGET,'LIFECYCLE',support=[support])
    selected=scheme.replace(b'NACNativeUITests',TARGET.encode()).replace(b'A10000000000000000000004',b'B10000000000000000000004').replace(b'container:NACLifecycleCaptureUITests.xcodeproj',b'container:NACNativeUITests.xcodeproj')
    output.mkdir(mode=0o700);proj=output/PROJECT.name;(proj/SCHEME.parent).mkdir(parents=True)
    (proj/'project.pbxproj').write_bytes(data);(proj/SCHEME.parent/(TARGET+'.xcscheme')).write_bytes(selected)
    return dict(project=str(proj),scheme=TARGET,sources=files,project_sha256=digest(data),scheme_sha256=digest(selected))


def runner(data,config,selection):
    def walk(v):
        if isinstance(v,dict):
            yield v
            for x in v.values():yield from walk(x)
        elif isinstance(v,list):
            for x in v:yield from walk(x)
    targets=[v for v in walk(data) if v.get('IsUITestBundle') is True]
    require(len(targets)==1 and targets[0].get('BlueprintName')==TARGET,'actual generated lifecycle target')
    target=targets[0]
    require(target.get('EnvironmentVariables',{}).get('NAC_UI_FIXTURE')==str(config)
        and target.get('TestBundlePath','').endswith('.xctest'),'real configuration/test bundle')
    for path,sha in selection['sources'].items():require(digest(Path(path).read_bytes())==sha,'compiler source changed')
    return target
