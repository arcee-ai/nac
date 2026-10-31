# Mac app updates and removal

The native shell, bundled `nac-web` engine and embedded web assets are one
application. Replace the complete `.app`; never replace just its engine or web
files. `nac-web upgrade` inside the app refuses before downloading or running
installer/uninstaller scripts, including when invoked through a symlink or
given a different installation directory. An incomplete or mismatched package
identity also refuses. Ordinary standalone CLI upgrades keep their existing
behavior; standalone source builds still require `make install-dev`.

## Whole-app replacement

For a qualified signed download, the first update flow is explicit
download/replace/relaunch. There is no automatic updater or channel switch.

1. Download the complete newer app into a separate location. Keep the installed
   app intact until the download and verification finish. Check the intended
   product version, source revision and build track. The package manifest binds
   the shell, engine and embedded asset inventory; a checksum or
   `PackageIdentity.json` alone does not authenticate its publisher. Developer ID,
   notarization and Gatekeeper evidence must belong to that exact artifact.
2. Finish active work or explicitly choose orderly stop-and-quit. Closing a
   window alone is not confirmation that the app and its engine have stopped.
   If quitting is canceled, leave the current app installed and running. If stop
   or cleanup fails, resolve that failure before replacing anything; do not kill
   an unrelated NAC process or delete a serving-store lease.
3. Once the app-owned engine and work have stopped, replace the entire app in
   its installation location. Keep the previous complete app available until
   the new installation has been checked. Do not merge `Contents` directories.
4. Relaunch using the same profile and existing configuration/store selection.
   Check the reported app/engine version and source, retained sessions and
   preferences before starting new work. Review uncertain interrupted commands;
   do not automatically replay sends, approvals or terminal input.

Canceling before replacement leaves the current complete installation in place.
If a download or copy is interrupted, keep the app stopped and retry with a
complete verified download. Do not launch a partial or mixed bundle. A saved
older app is not a promise that an already migrated database can be downgraded.

Ad-hoc preparation packages are development evidence, not qualified signed
downloads. The [package owner's qualification gates](../../desktop/macos/packaging/README.md)
and actual native lifecycle, storage and two-candidate replacement evidence are
required before declaring this flow qualified. CLI/unit tests establish only
the bundled self-upgrade refusal.

## Data and schema compatibility

Replacing or removing an app is separate from deleting NAC data. Preserve the
existing configuration directory (or explicit `NAC_HOME`), configured store
path, credentials, and native profile data. Continue using the same build track:
dev, beta and stable defaults are isolated as described in [Data stores](data-stores.md).
An app update does not select a public beta channel or copy stores between tracks.

Database migrations go forward only. An engine that cannot support the selected
schema must fail without rewriting it or choosing another store. If reopening
with an older app reports an unsupported schema, quit it and use a compatible
newer app against the original selected store. Preserve the failure details and
data for recovery. Do not lower SQLite's schema version, delete the database to
hide the failure, or assume reinstalling the old app reverses migrations.

## Removing the app

Quit the app and wait for its owned work to stop, then remove the `.app` bundle.
Do not point the standalone CLI uninstaller at `Contents/Resources`.

Removing the bundle leaves configuration, credentials, sessions and native
profile data in place. Deliberate data deletion is a separate destructive
operation: identify the exact profile and configured paths, preserve anything
needed, and ensure no app or standalone CLI owns those stores. This guide does
not run a data-deletion command or imply that deleting an app requests one.
