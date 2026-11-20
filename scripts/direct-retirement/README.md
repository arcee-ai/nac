# Direct-retirement inventory guard

`make test-direct-retirement` runs the guard's negative and positive controls,
then audits tracked text including hidden paths, checked-in browser output,
client declarations and the bundled guide. It does not traverse ignored build
outputs or follow tracked symlinks. The rule and baseline JSON files are guard
metadata rather than product inputs; all other tracked text is inspected.
Binary files and non-UTF-8 files are not classified as text.

The baseline manifest is the complete union of the three source inventories
specified in ALL-616 at revision `914782659a6183b89070a3516e2e44776b1eeb06`:
482 exact paths. The guard binds that sorted roster to a digest; it does not
need the historical Git object in a shallow CI checkout. Reproduce the three
inventories from the ticket before changing the roster or its digest.

Every baseline path has one disposition. `deleted` must remain absent;
`neutralized` must be tracked and have no current rule match. `historical`
and `unrelated` require a reason and at least one still-current match, all
covered by precise exceptions. `pending` is an explicit failure, not an
allowance. The initial inventory deliberately leaves unresolved candidates
pending for owner review. New files and matches are scanned independently of
the baseline inventory, so a new path cannot bypass the guard.

Rules identify exact retired contracts and a broader vocabulary inventory.
A reviewer must trace a match to its actual owner before deciding whether it is
active product behavior, a historical migration, or an unrelated concept.
Current executable behavior must be removed rather than excepted. An exception
is bound to an exact path, rule, SHA-256 digest, match count and explanation.
For ordinary files its digest is the UTF-8 bytes of the trimmed matching line;
this limits the allowance to that one line. Whole-file exceptions are allowed
only for explicitly named predecessor SQL fixtures or immutable CI evidence,
with a hash of the entire file. Every exception must match: removed, altered,
duplicate, overly broad and stale allowances fail.

A passing lexical guard is not a substitute for the ticket's semantic checks:
inspect the generated API schema and package declarations, built browser and
help outputs, fresh and migrated SQLite schemas, and actual native/MCP/CLI
behavior at the exact candidate revision. Record unavailable native or other
infrastructure evidence as a coverage gap.
