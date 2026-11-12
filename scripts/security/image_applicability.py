"""Exact-image applicability mechanics. No collection, policy approval, or exceptions.

The caller supplies independently verified observations, immutable retained
evidence bytes, and policy bytes from its trusted checkout. Candidate assertions
are never observations. See docs/security/image-applicability.md.
"""
import copy
import datetime as dt
import hashlib
import json
import re

import image_applicability_curl_release


POLICY_PATH = ".github/security/image-applicability.json"
MAX_POLICY_AGE = dt.timedelta(days=30)
MAX_EVIDENCE_AGE = dt.timedelta(hours=24)
BINDING_FIELDS = {"image", "source_revision", "platform", "package", "installed_package", "package_version",
                  "upstream_version", "source_sha256", "patches_sha256", "payload_sha256",
                  "application_profile_sha256"}
FINDING_FIELDS = {"package", "version", "source", "advisories"}
RULE_FIELDS = {"id", "finding", "binding", "disposition", "evidence_sha256", "review"}
AGGREGATE_RULE_FIELDS = (RULE_FIELDS - {"binding"}) | {"bindings"}
REVIEW_FIELDS = {"owner", "reviewer", "issue", "review", "reviewed_at", "expires_at"}


def require(condition, message):
    if not condition:
        raise ValueError(f"image applicability: {message}")


def exact(value, fields, label):
    require(isinstance(value, dict) and set(value) == fields, f"malformed {label}")


def identity(value, label):
    require(isinstance(value, str) and 0 < len(value) <= 1024 and
            value.strip() == value and not re.search(r"[\x00-\x1f\x7f*?]", value),
            f"invalid exact {label}")


def digest(value):
    require(isinstance(value, bytes), "evidence/policy inputs must be immutable bytes")
    return hashlib.sha256(value).hexdigest()


def sha(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value),
            f"invalid {label} digest")


def document(raw, label):
    digest(raw)

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f"duplicate {label} key")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: require(False, f"nonfinite {label} value"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"image applicability: invalid {label} JSON") from error


def timestamp(value):
    require(isinstance(value, str) and
            re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value),
            "timestamps must be UTC seconds")
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError as error:
        raise ValueError("image applicability: invalid timestamp") from error


def fresh(value, now, maximum, label):
    age = now - timestamp(value)
    require(dt.timedelta() <= age < maximum, f"stale/future {label}")


def binding(value):
    exact(value, BINDING_FIELDS, "binding")
    require(isinstance(value["image"], str) and
            re.fullmatch(r"sha256:[a-f0-9]{64}", value["image"]), "invalid immutable image")
    require(isinstance(value["source_revision"], str) and
            re.fullmatch(r"[a-f0-9]{40}", value["source_revision"]), "invalid source revision")
    require(value["platform"] == "linux/amd64", "unsupported platform")
    for field in ("package", "installed_package", "package_version", "upstream_version"):
        identity(value[field], field)
    require(":" in value["package"], "package needs its exact ecosystem")
    require(value["installed_package"].startswith("apk:") and len(value["installed_package"]) > 4,
            "installed package must name its actual APK identity")
    for field in BINDING_FIELDS - {"image", "source_revision", "platform", "package", "installed_package",
                                   "package_version", "upstream_version"}:
        sha(value[field], field)


def rule_bindings(rule):
    """Return the complete installed-payload set for either policy version."""
    return rule["bindings"] if "bindings" in rule else [rule["binding"]]


def scan_subject(value):
    exact(value, {"image", "source_revision", "platform"}, "scan identity")
    require(isinstance(value["image"], str) and
            re.fullmatch(r"sha256:[a-f0-9]{64}", value["image"]), "invalid scan image")
    require(isinstance(value["source_revision"], str) and
            re.fullmatch(r"[a-f0-9]{40}", value["source_revision"]), "invalid scan source")
    require(value["platform"] == "linux/amd64", "unsupported scan platform")


def finding_selector(value):
    exact(value, FINDING_FIELDS, "finding selector")
    for field in ("package", "version", "source"):
        identity(value[field], field)
    aliases = value["advisories"]
    require(isinstance(aliases, list) and 0 < len(aliases) <= 32, "invalid advisory list")
    for alias in aliases:
        identity(alias, "advisory")
    require(len(set(aliases)) == len(aliases), "duplicate advisory")


def review(value, now):
    exact(value, REVIEW_FIELDS, "review metadata")
    for field in ("owner", "reviewer"):
        identity(value[field], field)
    require(value["owner"] != value["reviewer"], "independent reviewer required")
    for field in ("issue", "review"):
        require(isinstance(value[field], str) and re.fullmatch(
            r"https://[A-Za-z0-9.-]+/[^\s?#]+(?:#[^\s]+)?", value[field]),
            "review/issue needs an exact HTTPS reference")
    start, end = timestamp(value["reviewed_at"]), timestamp(value["expires_at"])
    require(start <= now < end and dt.timedelta() < end - start <= MAX_POLICY_AGE,
            "expired/future or overlong policy review")


def policy(raw, now):
    value = document(raw, "policy")
    exact(value, {"schema_version", "rules"}, "policy")
    require(type(value["schema_version"]) is int and value["schema_version"] in {1, 2} and
            isinstance(value["rules"], list), "unsupported policy")
    schema = value["schema_version"]
    ids, selectors = set(), set()
    for rule in value["rules"]:
        aggregate = schema == 2 and isinstance(rule, dict) and "bindings" in rule
        exact(rule, AGGREGATE_RULE_FIELDS if aggregate else RULE_FIELDS, "rule")
        identity(rule["id"], "rule id")
        require(rule["id"] not in ids, "duplicate rule id")
        ids.add(rule["id"])
        finding_selector(rule["finding"])
        bindings = rule_bindings(rule)
        if aggregate:
            require(isinstance(bindings, list) and 2 <= len(bindings) <= 16,
                    "aggregate rule needs two to sixteen installed payloads")
        for item in bindings:
            binding(item)
            require(rule["finding"]["package"] == item["package"],
                    "finding and installed package differ")
            require(rule["finding"]["version"] in {item["package_version"],
                                                    item["upstream_version"]},
                    "finding version differs from truthful installed versions")
        if aggregate:
            names = [item["installed_package"] for item in bindings]
            require(names == sorted(set(names)),
                    "aggregate installed payloads must be unique and sorted")
        require(rule["disposition"] in {"fixed", "not_affected"}, "unsupported disposition")
        sha(rule["evidence_sha256"], "evidence")
        review(rule["review"], now)
        for advisory in rule["finding"]["advisories"]:
            key = tuple(rule["finding"][field] for field in ("package", "version", "source")) + (advisory,)
            require(key not in selectors, "overlapping rule selectors")
            selectors.add(key)
    return value


def evidence_for(rule, evidence, observations, now):
    # A shared scanner coordinate must cover its complete independently
    # observed installed-payload set, with no missing, duplicate or extra APK.
    bindings = rule_bindings(rule)
    coordinate_observations = [item for item in observations
                               if item["binding"]["package"] == rule["finding"]["package"]]
    require(len(coordinate_observations) == len(bindings),
            "shared/missing scanner coordinate requires aggregate installed-payload proof")
    require(all(sum(item["binding"] == bound for item in coordinate_observations) == 1
                for bound in bindings),
            "missing/mismatched independently verified observation")
    evidence_sha = rule["evidence_sha256"]
    require(evidence_sha in evidence, "missing reviewed evidence")
    raw = evidence[evidence_sha]
    require(digest(raw) == evidence_sha, "reviewed evidence hash mismatch")
    record = document(raw, "evidence")
    schema = 2 if "bindings" in rule else 1
    evidence_fields = {"schema_version", "rule_id", "collected_at", "artifacts", "proof"}
    evidence_fields.add("bindings" if schema == 2 else "binding")
    exact(record, evidence_fields, "evidence")
    require(type(record["schema_version"]) is int and record["schema_version"] == schema and
            record["rule_id"] == rule["id"], "evidence identity mismatch")
    require(rule_bindings(record) == bindings, "evidence binding mismatch")
    fresh(record["collected_at"], now, MAX_EVIDENCE_AGE, "evidence")
    require(timestamp(record["collected_at"]) <= timestamp(rule["review"]["reviewed_at"]),
            "evidence collected after its review")
    artifacts = record["artifacts"]
    require(isinstance(artifacts, dict) and artifacts, "missing reviewed proof artifacts")
    for name, value in artifacts.items():
        identity(name, "artifact role")
        sha(value, "artifact")
        require(value in evidence and digest(evidence[value]) == value, "missing/tampered proof artifact")
    proof = record["proof"]
    if rule["disposition"] == "fixed":
        if isinstance(proof, dict) and proof.get("kind") == "official-curl-fixed-release":
            image_applicability_curl_release.validate(rule, record, evidence)
        else:
            exact(proof, {"kind", "vulnerable_control", "fixed_control"}, "fixed proof")
            require(proof == {"kind": "regression", "vulnerable_control": "failed-as-expected",
                              "fixed_control": "passed"}, "unqualified regression controls")
            require({"vulnerable_control", "fixed_control", "provenance"} <= set(artifacts),
                    "missing regression artifacts")
    else:
        exact(proof, {"kind", "affected_applications"}, "absence proof")
        require(proof["kind"] == "application-absence" and
                isinstance(proof["affected_applications"], list) and proof["affected_applications"],
                "missing affected application scope")
        for application in proof["affected_applications"]:
            identity(application, "affected application")
        require(len(set(proof["affected_applications"])) == len(proof["affected_applications"]),
                "duplicate affected application")
        require({"complete_filesystem", "complete_consumers", "provenance"} <= set(artifacts),
                "absence requires complete filesystem and consumer artifacts")
    return record


def verify_applicability(findings, *, trusted_policy, candidate_policy, evidence,
                         observations, scan_identity, now, reviewed_image_approval=None):
    """Return separate dispositions and raw indexes; raise on invalid trust/evidence.

    `observations` MUST come from the caller's independent exact-image integrity
    verification, never from candidate evidence. `evidence` maps SHA-256 to bytes.
    This function does not approve rules, collect evidence, or alter severities.
    """
    require(isinstance(now, dt.datetime) and now.tzinfo is not None and now.utcoffset() == dt.timedelta(),
            "a timezone-aware UTC clock is required")
    require(digest(trusted_policy) == digest(candidate_policy) and trusted_policy == candidate_policy,
            "candidate policy differs from trusted policy; land human-reviewed policy separately")
    baseline = policy(trusted_policy, now)
    require(not baseline["rules"], "source policy cannot approve a future image; use post-build approval")
    if reviewed_image_approval is not None:
        require(digest(reviewed_image_approval) != digest(candidate_policy),
                "post-build approval must be separate from source policy")
    admitted_bytes = reviewed_image_approval if reviewed_image_approval is not None else trusted_policy
    admitted = policy(admitted_bytes, now)
    scan_subject(scan_identity)
    require(isinstance(evidence, dict) and isinstance(observations, list), "invalid evidence inputs")
    for item in observations:
        exact(item, {"binding", "observed_at"}, "observation")
        binding(item["binding"])
        require(all(item["binding"][key] == value for key, value in scan_identity.items()),
                "observation differs from scanned image/source/platform")
        fresh(item["observed_at"], now, MAX_EVIDENCE_AGE, "observation")
    require(isinstance(findings, list), "findings must be a list")
    raw = copy.deepcopy(findings)
    for finding in raw:
        require(isinstance(finding, dict) and finding.get("context") == "managed-image",
                "invalid finding context")
        for field in ("advisory", "package", "version", "source"):
            identity(finding.get(field), f"finding {field}")
    # Validate every rule, including currently unmatched rules: stale or tampered
    # policy evidence cannot disappear merely because today's scanner has no row.
    for rule in admitted["rules"]:
        require(all(bound[key] == value for bound in rule_bindings(rule)
                    for key, value in scan_identity.items()),
                "rule differs from scanned image/source/platform")
        evidence_for(rule, evidence, observations, now)
    dispositions, unresolved = [], []
    for index, finding in enumerate(raw):
        matches = [rule for rule in admitted["rules"] if
                   all(finding[field] == rule["finding"][field] for field in ("package", "version", "source")) and
                   finding["advisory"] in rule["finding"]["advisories"]]
        if not matches:
            unresolved.append(index)
            continue
        rule = matches[0]
        dispositions.append({"finding_index": index, "rule_id": rule["id"],
                             "disposition": rule["disposition"],
                             "rule_sha256": digest(json.dumps(rule, sort_keys=True, separators=(",", ":")).encode()),
                             "evidence_sha256": rule["evidence_sha256"]})
    return {"schema_version": 1, "policy_sha256": digest(admitted_bytes),
            "candidate_policy_sha256": digest(candidate_policy),
            "approval_mode": "post-build" if reviewed_image_approval is not None else "none",
            "raw_findings": raw, "dispositions": dispositions, "unresolved_indexes": unresolved}
