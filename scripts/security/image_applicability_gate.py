"""Join verified applicability with source-policy results without rewriting either."""
from collections import Counter, defaultdict, deque
import copy
import datetime as dt
import json
import os
from pathlib import Path
import stat

import image_applicability as applicability
from image_inventory import require, sha256, write_json


MAX_ARTIFACT = 16 * 1024 * 1024
MAX_EVIDENCE = 256 * 1024 * 1024
MAX_POLICY = 1024 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def policy_bytes(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
        require(stat.S_ISREG(os.fstat(source.fileno()).st_mode), "image policy must be a regular file")
        raw = source.read(MAX_POLICY + 1)
    require(len(raw) <= MAX_POLICY, "image policy exceeds byte budget")
    return raw


def raw_policy_rows(result):
    require(set(result) in ({"blocking", "excepted", "reporting"},
                           {"blocking", "excepted", "reporting", "policy_source"}),
            "invalid source-policy result")
    require(all(isinstance(result[key], list) for key in ("blocking", "excepted", "reporting")),
            "invalid source-policy classifications")
    rows = list(result["blocking"]) + list(result["reporting"])
    for row in result["excepted"]:
        require(isinstance(row, dict) and isinstance(row.get("exception"), dict),
                "invalid source exception metadata")
        rows.append({key: value for key, value in row.items() if key != "exception"})
    return rows


def reconcile(findings, source_result, receipt):
    """Map duplicate rows by occurrence; only verified raw indexes remove blockers."""
    require(isinstance(findings, list) and all(isinstance(row, dict) for row in findings),
            "invalid raw image findings")
    require(Counter(map(canonical, findings)) == Counter(map(canonical, raw_policy_rows(source_result))),
            "source-policy rows differ from raw findings")
    require(receipt.get("schema_version") == 1 and receipt.get("raw_findings") == findings,
            "applicability receipt differs from raw findings")
    dispositions, unresolved = receipt.get("dispositions"), receipt.get("unresolved_indexes")
    require(isinstance(dispositions, list) and isinstance(unresolved, list),
            "invalid applicability index partition")
    indexes = []
    for item in dispositions:
        require(isinstance(item, dict) and set(item) == {
            "finding_index", "rule_id", "disposition", "rule_sha256", "evidence_sha256"},
            "invalid verified disposition")
        require(item["disposition"] in {"fixed", "not_affected"}, "unknown image disposition")
        applicability.identity(item["rule_id"], "rule id")
        for key in ("rule_sha256", "evidence_sha256"):
            applicability.sha(item[key], key)
        indexes.append(item["finding_index"])
    partition = indexes + unresolved
    require(all(type(index) is int for index in partition) and
            sorted(partition) == list(range(len(findings))),
            "applicability must classify every raw index exactly once")
    available = defaultdict(deque)
    for index, row in enumerate(findings):
        available[canonical(row)].append(index)
    blocking = [available[canonical(row)].popleft() for row in source_result["blocking"]]
    approved = set(indexes)
    return [index for index in blocking if index not in approved]


def read_artifact(directory, digest):
    applicability.sha(digest, "artifact")
    path = Path(directory) / digest
    # Policy supplies a digest, never a path. Do not accept repository symlinks.
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
        require(stat.S_ISREG(os.fstat(source.fileno()).st_mode),
                "reviewed artifact must be a regular file")
        raw = source.read(MAX_ARTIFACT + 1)
    require(len(raw) <= MAX_ARTIFACT and applicability.digest(raw) == digest,
            "reviewed artifact missing, oversized or altered")
    return raw


def reviewed_evidence(policy, directory):
    evidence = {}
    for rule in policy["rules"]:
        digest = rule["evidence_sha256"]
        if digest not in evidence:
            evidence[digest] = read_artifact(directory, digest)
        record = applicability.document(evidence[digest], "evidence")
        require(isinstance(record, dict) and isinstance(record.get("artifacts"), dict),
                "malformed reviewed evidence artifact list")
        for digest in record["artifacts"].values():
            if digest not in evidence:
                evidence[digest] = read_artifact(directory, digest)
        require(sum(map(len, evidence.values())) <= MAX_EVIDENCE,
                "reviewed image evidence exceeds total byte budget")
    return evidence


def evaluate(findings, *, trusted_path, candidate_path, observations, scan_identity,
             evidence_directory=None, now=None):
    """Missing trusted capability admits nothing; candidate rules cannot bootstrap."""
    now = now or dt.datetime.now(dt.timezone.utc)
    applicability.scan_subject(scan_identity)
    candidate_path, trusted_path = Path(candidate_path), Path(trusted_path)
    if not (candidate_path.exists() or candidate_path.is_symlink() or
            trusted_path.exists() or trusted_path.is_symlink()):
        return {"schema_version": 1, "status": "inactive", "reason": "capability-not-configured",
                "policy_sha256": None, "candidate_policy_sha256": None,
                "raw_findings": copy.deepcopy(findings), "dispositions": [],
                "unresolved_indexes": list(range(len(findings)))}
    candidate = policy_bytes(candidate_path)
    candidate_policy = applicability.policy(candidate, now)
    if not (trusted_path.exists() or trusted_path.is_symlink()):
        require(not candidate_policy["rules"],
                "candidate applicability rules have no trusted policy; separate human landing required")
        return {"schema_version": 1, "status": "inactive", "reason": "trusted-policy-unavailable",
                "policy_sha256": None, "candidate_policy_sha256": applicability.digest(candidate),
                "raw_findings": copy.deepcopy(findings), "dispositions": [],
                "unresolved_indexes": list(range(len(findings)))}
    require(trusted_path.is_file() and not trusted_path.is_symlink(), "invalid trusted image policy file")
    trusted = policy_bytes(trusted_path)
    require(trusted == candidate, "candidate changes image applicability policy; land reviewed policy separately")
    admitted = applicability.policy(trusted, now)
    directory = evidence_directory or trusted_path.parent / "image-applicability-evidence"
    evidence = reviewed_evidence(admitted, directory)
    result = applicability.verify_applicability(findings, trusted_policy=trusted,
        candidate_policy=candidate, evidence=evidence, observations=observations if admitted["rules"] else [],
        scan_identity=scan_identity, now=now)
    return {**result, "status": "verified"}


def retain_decision(directory, source_result, receipt, identity):
    """Retain separate raw, policy, applicability and effective decision evidence."""
    findings_path = directory / "findings.json"
    findings = json.loads(findings_path.read_bytes())
    require(json.loads((directory / "policy-result.json").read_bytes()) == source_result,
            "source-policy result was changed before applicability")
    blocking = reconcile(findings, source_result, receipt)
    write_json(directory / "applicability-result.json", receipt)
    decision = {"schema_version": 1, "image": identity["image"],
                "source_revision": identity["source_revision"], "blocking_indexes": blocking,
                "raw_findings_sha256": sha256(findings_path),
                "source_policy_result_sha256": sha256(directory / "policy-result.json"),
                "applicability_result_sha256": sha256(directory / "applicability-result.json")}
    write_json(directory / "decision.json", decision)
    return decision


def validated_decision(directory, findings, source_result, identity):
    """Reporter checks the complete partition and all unchanged source receipts."""
    decision = json.loads((directory / "decision.json").read_bytes())
    require(set(decision) == {"schema_version", "image", "source_revision", "blocking_indexes",
                             "raw_findings_sha256", "source_policy_result_sha256",
                             "applicability_result_sha256"} and
            type(decision["schema_version"]) is int and decision["schema_version"] == 1,
            "invalid effective image decision")
    require(all(decision[key] == identity[key] for key in ("image", "source_revision")),
            "effective decision differs from scanned image/source")
    for key, file in (("raw_findings_sha256", "findings.json"),
                      ("source_policy_result_sha256", "policy-result.json"),
                      ("applicability_result_sha256", "applicability-result.json")):
        require(decision[key] == sha256(directory / file), "effective image decision inputs changed")
    receipt = json.loads((directory / "applicability-result.json").read_bytes())
    require(receipt.get("status") in {"inactive", "verified"}, "unknown applicability state")
    if receipt["status"] == "inactive":
        require(receipt.get("reason") in {"trusted-policy-unavailable", "capability-not-configured"} and
                receipt.get("policy_sha256") is None and not receipt.get("dispositions"),
                "inactive applicability cannot admit findings")
    else:
        applicability.sha(receipt.get("policy_sha256"), "trusted policy")
    require(decision["blocking_indexes"] == reconcile(findings, source_result, receipt),
            "effective blockers differ from verified dispositions")
    return decision
