"""Secret-free signature plans and evidence checks, shared by package modes.

Developer-ID command construction is not authorization to execute it. No identity
lookup, keychain mutation, credential discovery or notary submission lives here.
"""
from dataclasses import dataclass
from pathlib import PurePosixPath
import re


@dataclass(frozen=True)
class SignaturePolicy:
    kind: str
    certificate_sha1: str | None = None
    team_id: str | None = None

    def __post_init__(self):
        if self.kind == 'ad-hoc':
            if self.certificate_sha1 is not None or self.team_id is not None:
                raise ValueError('Ad-hoc signing must not select a certificate or team')
        elif self.kind == 'developer-id':
            if not re.fullmatch(r'[A-Fa-f0-9]{40}', self.certificate_sha1 or ''):
                raise ValueError('Developer ID requires an explicitly authorized certificate SHA-1')
            if not re.fullmatch(r'[A-Z0-9]{10}', self.team_id or ''):
                raise ValueError('Developer ID requires the explicitly authorized NAC Team ID')
        else:
            raise ValueError('Unknown signature kind')

    def requirement(self):
        if self.kind != 'developer-id':
            raise ValueError('Ad-hoc code has no Developer ID trust requirement')
        # Apple TN3127: Apple anchor + Developer ID CA + Application leaf + team.
        return ('anchor apple generic and '
                'certificate 1[field.1.2.840.113635.100.6.2.6] exists and '
                'certificate leaf[field.1.2.840.113635.100.6.1.13] exists and '
                f'certificate leaf[subject.OU] = "{self.team_id}"')


def nested_targets(app, relative_paths):
    paths = []
    for name in relative_paths:
        path = PurePosixPath(name)
        if (path.is_absolute() or '..' in path.parts or '.' in path.parts
                or len(path.parts) < 2 or path.parts[0] != 'Contents'
                or str(path) != name):
            raise ValueError('Nested code must have a canonical bundle-relative path')
        paths.append(path)
    if not paths or len(set(paths)) != len(paths):
        raise ValueError('Nested signing paths must be nonempty and unique')
    # Inner code first. The bundle/main executable is signed by the outer target.
    return [app / str(path) for path in sorted(paths, key=lambda x: (-len(x.parts), str(x)))]


def signing_commands(app, relative_paths, policy):
    commands = []
    for target in [*nested_targets(app, relative_paths), app]:
        identity = '-' if policy.kind == 'ad-hoc' else policy.certificate_sha1
        timestamp = '--timestamp=none' if policy.kind == 'ad-hoc' else '--timestamp'
        commands.append(['/usr/bin/codesign', '--force', '--sign', identity, timestamp,
                         '--options', 'runtime', str(target)])
    return commands


def verification_commands(app, relative_paths, policy):
    commands = []
    for target in [*nested_targets(app, relative_paths), app]:
        command = ['/usr/bin/codesign', '--verify', '--strict', '--verbose=2']
        if policy.kind == 'developer-id':
            command.extend(['--test-requirement', '=' + policy.requirement()])
        commands.append([*command, str(target)])
    commands.append(['/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)])
    return commands


def inspection_commands(app, relative_paths):
    return [{'target': str(target),
             'entitlements_argv': ['/usr/bin/codesign', '-d', '--entitlements', ':-', str(target)],
             'details_argv': ['/usr/bin/codesign', '-d', '--verbose=4', str(target)]}
            for target in [*nested_targets(app, relative_paths), app]]


def signature_evidence(details, entitlements, policy):
    """Parse facts after successful codesign verification; never retain personal CNs."""
    if entitlements:
        raise ValueError('Unexpected entitlements; changing this policy requires review')
    flags = re.findall(r'\bflags=0x([0-9a-fA-F]+)\(', details)
    if len(flags) != 1 or not int(flags[0], 16) & 0x10000:
        raise ValueError('Missing hardened-runtime code signature flag')
    adhoc = bool(re.search(r'^Signature=adhoc$', details, re.M))
    if policy.kind == 'ad-hoc':
        if not adhoc:
            raise ValueError('Expected an ad-hoc signature')
        return {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
    teams = re.findall(r'^TeamIdentifier=(.+)$', details, re.M)
    timestamps = re.findall(r'^Timestamp=(.+)$', details, re.M)
    if adhoc or teams != [policy.team_id] or len(timestamps) != 1 or not timestamps[0].strip():
        raise ValueError('Developer ID requires the authorized team and secure timestamp')
    if not re.search(r'^Authority=Developer ID Application:', details, re.M):
        raise ValueError('Expected Developer ID Application authority')
    return {'kind': 'developer-id', 'team_id': policy.team_id, 'hardened_runtime': True,
            'secure_timestamp': True, 'entitlements': {}}


def notarization_plan(app, submission_zip, profile):
    """Ordered reviewable commands. Callers must enforce each intervening gate."""
    if not profile or profile.startswith('-') or any(ord(x) < 32 for x in profile):
        raise ValueError('An explicit existing notary keychain profile is required')
    return {'execution_authorized': False, 'requires_normal_app': True,
            'stages': [
                {'name': 'submission-container', 'argv': ['/usr/bin/ditto', '-c', '-k',
                    '--sequesterRsrc', '--keepParent', str(app), str(submission_zip)]},
                {'name': 'notary-submit', 'argv': ['/usr/bin/xcrun', 'notarytool', 'submit',
                    str(submission_zip), '--keychain-profile', profile, '--wait', '--output-format', 'json'],
                 'gate': 'Require successful tool exit plus Accepted JSON for the retained submission digest'},
                {'name': 'staple-app', 'argv': ['/usr/bin/xcrun', 'stapler', 'staple', str(app)]},
                {'name': 'validate-staple', 'argv': ['/usr/bin/xcrun', 'stapler', 'validate', str(app)]},
                {'name': 'gatekeeper-assessment', 'argv': ['/usr/sbin/spctl', '--assess', '--type',
                    'execute', '--verbose=4', str(app)]},
            ], 'finalization': 'After stapling, create a NEW final ZIP and regenerate app/container digests; '
               'quarantined download, Applications and actual translocation tests remain separate'}


def accepted_notarization(response):
    if not isinstance(response, dict) or response.get('status') != 'Accepted':
        raise ValueError('Notarization has not been accepted')
    submission_id = response.get('id', '')
    if not isinstance(submission_id, str) or not re.fullmatch(
            r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', submission_id):
        raise ValueError('Missing exact notary submission ID')
    return {'submission_id': submission_id, 'status': 'Accepted'}
