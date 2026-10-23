# Repository credential security

NAC enables GitHub secret scanning and push protection. If GitHub blocks a push,
remove the credential from every unpublished commit that contains it. Treat a
real credential that reached GitHub as compromised and revoke it at its provider.
Do not paste credentials into issues, pull requests, chat, or command output.

See the [repository secret response guide](docs/security/repository-secrets.md)
for alert ownership, rotation, removal, scoped false-positive handling, and
qualification evidence. Repository administrators can triage privately in
[NAC's secret-scanning alerts](https://github.com/arcee-ai/nac/security/secret-scanning).
