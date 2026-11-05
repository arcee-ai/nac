#!/usr/bin/env python3
"""Private bounded OS-archive cold/miss -> verified-hit mechanism experiment.

No shared cache writes, package installation, quality verdicts or production edits.
Uses an existing pinned image; never pulls/builds one or installs host tools.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shlex
import sys
import time
from urllib.parse import unquote

sys.dont_write_bytecode = True


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


base = module('transport', 'apt-transport-probe.py')
store = module('store', 'apt-archive-store.py')
IMAGE = 'docker.io/library/ubuntu@sha256:157dc3d6e4a3e4f2c68d12df9df9ed6e808b59af6d4c3757b432b4f519916725'


def requests(web):
    bundle = web/'node_modules/playwright-core/lib/coreBundle.js'
    package = json.loads((web/'node_modules/playwright-core/package.json').read_text())
    lock = json.loads((web/'package-lock.json').read_text())
    if lock['packages']['node_modules/playwright-core']['version'] != package['version']:
        raise ValueError('installed Playwright differs from current lock; setup required')
    text = bundle.read_text()
    marker = '"ubuntu26.04-x64": {'
    # This is a fail-closed reader of locked official data, never eval/copy of its implementation.
    chunk = text[text.index(marker):]
    chunk = chunk[:chunk.index('firefox:')]
    result = []
    for name in ('tools', 'chromium'):
        matches = re.findall(r'\b'+name+r':\s*(\[[^\]]+\])', chunk)
        if len(matches) != 1:
            raise ValueError('locked Playwright dependency data format changed')
        entries = json.loads(matches[0])
        if not entries or any(not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', x) for x in entries):
            raise ValueError('unsafe/empty current Playwright request')
        result.extend(entries)
    return sorted(set(result)), {'version':package['version'],
        'bundle_sha256':base.digest(bundle.read_bytes()),
        'lock_sha256':base.digest((web/'package-lock.json').read_bytes())}


def selected(text):
    if any(line.startswith('Remv ') for line in text.splitlines()):
        raise ValueError('unexpected package removal in simulated dependency closure')
    rows = re.findall(r'^Inst ([a-z0-9][a-z0-9+.-]*)(?: \[[^\]]+\])? \((\S+)', text, re.M)
    if not rows or len(rows) != len({x[0] for x in rows}):
        raise ValueError('empty/ambiguous solver closure; not a cache-hit measurement')
    if sum(line.startswith('Inst ') for line in text.splitlines()) != len(rows):
        raise ValueError('unsupported solver record/architecture')
    return rows


def package_pin(text, name, version, offers):
    rows = text if isinstance(text,list) else [base.fields(x) for x in text.strip().split('\n\n')]
    pins = {store.canonical({k:r[k] for k in store.FIELDS}) for r in rows
            if r.get('Package')==name and r.get('Version')==version
            and store.offer_name(r) in offers
            and offers[store.offer_name(r)] == (r['Filename'], int(r['Size']))}
    if len(pins) != 1:
        raise ValueError(f'exact current package metadata ambiguous/missing: {name}={version}')
    return json.loads(pins.pop())


def archive_offers(text):
    offers={}
    for line in text.splitlines():
        if not line.startswith("'http"):
            continue
        parts=shlex.split(line)
        prefix='http://azure.archive.ubuntu.com/ubuntu/'
        if len(parts)!=4 or not parts[0].startswith(prefix) or parts[1] in offers:
            raise ValueError('unexpected selected archive URI')
        offers[parts[1]]=(unquote(parts[0][len(prefix):],errors='strict'),int(parts[2]))
    return offers


class Experiment(base.Probe):
    def __init__(self, args):
        super().__init__(args)
        self.report.update(script_sha256=base.digest(Path(__file__).read_bytes()),
            store_sha256=base.digest(Path(store.__file__).read_bytes()),
            transport_controller_sha256=base.digest(Path(base.__file__).read_bytes()),
            qualification='Unassigned package-byte reuse experiment; campaign14/0of10 unchanged.',
            coverage='Real APT download-only closure, not package installation, Chromium or NAC journeys.',
            shared_cache_write=False, cache_origin='private same-invocation snapshot only')

    def configure(self, label):
        root = '/tmp/nac-apt-'+label
        directories = ('parts', 'sources', 'lists/partial', 'state', 'archives/partial', 'downloads', 'log')
        self.execute(label+'-mkdir', ['mkdir','-p',*[root+'/'+x for x in directories]])
        self.execute(label+'-empty', ['touch',root+'/empty.conf'])
        config = f'''Dir::Etc::main "{root}/empty.conf";
Dir::Etc::parts "{root}/parts";
Dir::Etc::sourcelist "{root}/sources.list";
Dir::Etc::sourceparts "{root}/sources";
Dir::State "{root}/state";
Dir::State::lists "{root}/lists";
Dir::State::status "/var/lib/dpkg/status";
Dir::Cache "{root}/cache";
Dir::Cache::archives "{root}/archives";
Dir::Cache::pkgcache "";
Dir::Cache::srcpkgcache "";
Dir::Log "{root}/log";
APT::Architecture "amd64";
APT::Architectures {{ "amd64"; }};
APT::Architecture-Variants "amd64v3";
Acquire::Check-Date "true";
Acquire::Check-Valid-Until "true";
Acquire::AllowInsecureRepositories "false";
Acquire::AllowDowngradeToInsecureRepositories "false";
Debug::NoLocking "true";
'''
        self.execute(label+'-config', ['tee',root+'/apt.conf'], input_data=config.encode())
        # Explicit arch=amd64 would override APT's default expanded variant set.
        sources = ''.join(f'deb [signed-by={base.KEYRING}] '
            f'http://azure.archive.ubuntu.com/ubuntu {suite} main restricted universe multiverse\n'
            for suite in ('resolute','resolute-updates','resolute-security','resolute-backports'))
        self.execute(label+'-sources', ['tee',root+'/sources.list'],input_data=sources.encode())
        return root

    def apt(self, label, root, args, **kwargs):
        return self.execute(label, ['env','APT_CONFIG='+root+'/apt.conf',
                                   'HOME='+root,*args], **kwargs)

    def resolve(self, label, names):
        root = self.configure(label)
        self.apt(label+'-update',root,['apt-get','update','--error-on=any'])
        releases = self.execute(label+'-releases',['find',root+'/lists','-maxdepth','1',
                            '-type','f','-name','*_InRelease']).decode().splitlines()
        if len(releases)!=4:
            raise ValueError('fresh signed suite inventory differs')
        signed=[]
        for i,path in enumerate(sorted(releases)):
            raw=self.execute(f'{label}-release-{i}',['cat',path])
            self.execute(f'{label}-gpgv-{i}',['gpgv','--keyring',base.KEYRING,path])
            signed.append({'sha256':base.digest(raw),'fields':{k:v for k,v in base.fields(raw.decode()).items()
                if k in ('Suite','Codename','Date','Valid-Until')}})
        simulation=self.apt(label+'-solver',root,['apt-get','-s','install','--no-install-recommends',*names]).decode()
        uri_text=self.apt(label+'-uris',root,['apt-get','--print-uris','--download-only','--yes',
            'install','--no-install-recommends',*names]).decode()
        offers=archive_offers(uri_text)
        closure=selected(simulation)
        raw=self.apt(label+'-metadata-batch',root,['apt-cache','show',
            *[name+'='+version for name,version in closure]]).decode()
        records=[base.fields(x) for x in raw.strip().split('\n\n')]
        pins=[package_pin(records,name,version,offers) for name,version in closure]
        if {store.offer_name(p) for p in pins} != set(offers):
            raise ValueError('selected URI inventory differs from full closure')
        plan={'schema':1,'repository':self.args.repository,'platform':'ubuntu26.04-amd64-amd64v3',
              'packages':sorted(pins,key=lambda p:p['Package'])}
        store.validate_plan(plan)
        self.report[label+'_signed_metadata']=signed
        self.report[label+'_plan']=plan
        return root,plan

    def negatives(self, plan, snapshot):
        results={}
        for label,change in [('wrong-platform',lambda p:p.update(platform='ubuntu24.04-amd64')),
                             ('foreign-repository',lambda p:p.update(repository='foreign/repository')),
                             ('stale-version',lambda p:p['packages'][0].update(Version='0.invalid'))]:
            altered=json.loads(json.dumps(plan));change(altered)
            try: store.restore(altered,snapshot,self.output/('invalid-'+label))
            except ValueError: results[label]='rejected before offer'
            else: raise ValueError('negative accepted: '+label)
        target=snapshot/(plan['packages'][0]['SHA256']+'.deb')
        original=target.read_bytes()
        for label,operation in [('corrupt',lambda:target.write_bytes(original[:-1]+bytes([original[-1]^1]))),
                                ('partial',lambda:target.unlink()),
                                ('link',lambda:(target.unlink(),target.symlink_to('/etc/passwd')))]:
            operation()
            try: store.restore(plan,snapshot,self.output/('invalid-'+label))
            except (ValueError,OSError): results[label]='rejected before offer'
            else: raise ValueError('negative accepted: '+label)
            finally:
                target.unlink(missing_ok=True);target.write_bytes(original)
        if any((self.output/('invalid-'+label)).exists() for label in results):
            raise ValueError('negative exposed archive root')
        self.report['negative_controls']=results

    def run(self):
        try:
            inspect=json.loads(self.command('image',['docker','image','inspect',self.args.image]))
            if len(inspect)!=1 or inspect[0]['Architecture']!='amd64':
                raise ValueError('existing image must match pinned amd64 source')
            if self.command('source',['git','rev-parse','HEAD']).decode().strip()!=self.args.source:
                raise ValueError('exact checkout source mismatch')
            names,tool=requests(self.args.web)
            self.report.update(playwright_requests=names,playwright=tool)
            import uuid
            self.container='nac-apt-reuse-'+uuid.uuid4().hex[:12]
            self.command('container',['docker','run','-d','--rm','--name',self.container,
                '--platform','linux/amd64','--user','65534:65534','--cpus','2','--memory','768m',
                '--memory-swap','768m','--pids-limit','128',self.args.image,'sleep','1800'])
            self.report['container']=self.container
            self.execute('uid',['id'])
            os_release=self.execute('os',['cat','/etc/os-release']).decode()
            if 'VERSION="26.04.1 LTS' not in os_release:
                raise ValueError('wrong actual OS release')
            cold,plan=self.resolve('cold',names)
            snapshot=self.output/'snapshot'
            self.report['miss']=store.restore(plan,snapshot,self.output/'miss-offer')
            tick=time.monotonic()
            self.apt('cold-download',cold,['apt-get','--download-only','--yes','install',
                                        '--no-install-recommends',*names])
            self.report['cold_download_seconds']=time.monotonic()-tick
            files=self.execute('cold-archives',['find',cold+'/archives','-maxdepth','1','-type','f',
                                              '-name','*.deb']).decode().splitlines()
            if len(files)!=len(plan['packages']):
                raise ValueError('APT downloaded inventory differs from full solver closure')
            inputs={}
            for i,path in enumerate(sorted(files)):
                if not re.fullmatch(r'/tmp/nac-apt-cold/archives/[A-Za-z0-9_.+:%~-]+\.deb',path):
                    raise ValueError('unsafe archive path')
                fields=base.fields(self.execute(f'cold-control-{i}',
                    ['dpkg-deb','-f',path,'Package','Version','Architecture']).decode())
                if fields['Package'] in inputs:
                    raise ValueError('duplicate archive')
                tick=time.monotonic()
                raw=self.execute(f'cold-bytes-{i}',['cat',path])
                self.report.setdefault('container_to_host_copy_seconds',0)
                self.report['container_to_host_copy_seconds']+=time.monotonic()-tick
                inputs[fields['Package']]=self.output/f'cold-bytes-{i}.stdout'
            self.report['export']=store.export(plan,inputs,snapshot,
                {'source':self.args.source,'origin':'same-invocation-private-no-shared-cache-write'})
            warm,warm_plan=self.resolve('hit',names)
            if warm_plan!=plan:
                raise ValueError('fresh hit resolver changed closure; stop comparison')
            offer=self.output/'verified-offer'
            self.report['restore']=store.restore(warm_plan,snapshot,offer)
            tick=time.monotonic()
            self.command('offer-copy',['docker','cp',str(offer)+'/.',self.container+':'+warm+'/archives'])
            self.report['offer_copy_seconds']=time.monotonic()-tick
            tick=time.monotonic()
            raw=self.apt('hit-download-only',warm,['apt-get','--download-only','--yes','install',
                                                '--no-install-recommends',*names])
            self.report['hit_apt_seconds']=time.monotonic()-tick
            if re.search(rb'^Get:\d+',raw,re.M) or not re.search(rb'Need to get 0 B/',raw):
                raise ValueError('APT did not confirm zero-byte archive reuse')
            self.negatives(plan,snapshot)
            self.container_bound('final')
            self.report['status']='verified APT cold/miss -> byte-validated hit; mechanism only'
        except Exception as error:
            self.report['error']=str(error)
        finally:
            try:self.cleanup()
            except Exception as error:
                self.report.update(cleanup_error=str(error),status='failed')
            self.report.update(ended_at=base.now(),elapsed_seconds=time.monotonic()-self.started)
            (self.output/'report.json').write_text(json.dumps(self.report,indent=2)+'\n')
        return 0 if self.report['status'].startswith('verified APT cold/miss') else 1


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--source',required=True)
    parser.add_argument('--repository',default='arcee-ai/nac')
    parser.add_argument('--web',type=Path,default=Path('crates/nac-server/web'))
    args=parser.parse_args();args.image=IMAGE
    if not re.fullmatch(r'[0-9a-f]{40}',args.source):parser.error('immutable source required')
    return Experiment(args).run()


if __name__=='__main__':raise SystemExit(main())
