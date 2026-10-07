# Frozen canonical runtime control fixtures

`vectors.compact.json` is a verbatim mirror of the B-owned generated companion
from `arcee-ai/ArceeFM` commit `e17cb1cdae056e5b838f8ff56e70f1e29b2aa1e4`, path
`docs/clerk/managed-runtime-control-v1-vectors.compact.json`.
Its SHA256 is `5137bd79278c446f64f3c119fd9cfa9b807708d57e2dc62a20e3b5a3ec2362dd`.

Only B's `local-scripts/clerk-runtime-control-v1/generate_vectors.py` writes the
fixture values and canonical payload strings. Native consumers freeze accepted
outputs without regenerating, reformatting, or editing them. Rust tests verify
the entire artifact hash and independently check every canonical byte string,
domain digest, strict decoder negative and tuple/time comparison. No external
checkout is a build input and no upstream implementation is imported.

These are public-format test data, not authenticated issuer decisions or current
policy. Successful byte comparisons confer no native authority.

This local slice derives from B's explicitly held publication. Keep its source,
fixture and related publication local until the owning B publication approval
actually clears; the independent transport/journal PR does not clear that hold.
