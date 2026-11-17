# Optional live native acceptance

This is a test-only held fixture, outside the shipped application. Run it only
with an available unlocked Mac console and a separately coordinated native actor.
It does not change privacy/security settings, attach to a personal store, install
a bridge, intercept the system opener, or inject UI input. The default automated
suite explicitly skips this optional case; a skip supplies no acceptance evidence.

The completed development candidate's evidence and retained failures are recorded
in [NATIVE-ACCEPTANCE.md](NATIVE-ACCEPTANCE.md).

```sh
NAC_ELECTRON_NATIVE_MANUAL=1 \
NAC_ELECTRON_APP="$PWD/target/electron-review-relocation/Folder With Spaces/NAC Electron.app" \
  npm --prefix desktop/electron run test:e2e -- native-manual.spec.ts
```

The controller prints `NATIVE_MANUAL_READY` with its private `ready.json` path.
Run the command from the repository root. The example uses a portable checkout
path; it does not identify the binary from any historical acceptance run.
Original local packets can contain absolute paths. Public PR attachments need
redaction; new visual evidence should use a private fixture root under `/tmp`
and exclude unrelated native windows or personal paths in picker sidebars.
The profile is private and isolated. Before the actual app launch, the controller
uses that bundle's exact engine/custody modules to seed a model, project, direct
chat, eligible committed file and disabled MCP OAuth server. It stops/reaps that
preparation engine, then starts the relocated app through `/usr/bin/open` with a
minimal system PATH, explicit private HOME/NAC_HOME/XDG/store/userData and no
debugger. Rust still performs normal configuration, identity, store and schema
admission. The provider and existing local Python authentication double remain
alive for at most ten minutes of native interaction.

`ready.json` records the manifest and engine hashes, canonical bundle, private
store, LaunchServices app PID/kernel birth, exact engine/custody process ancestry,
workspace, reveal leaf, selected-folder path and finish control. Read-only kernel
listener discovery supplies the fixture API endpoint only after that exact
owned process relationship is observed; it grants no product attachment or
engine adoption. `status.json` records current app liveness and independently
observed fixture results. The private finish file is a controller control, never
a product capability or an app input channel.

The native actor performs these steps against the independently verified live
app only:

1. Check the exact PID and birth are live using the private output's
   `process-sample` binary and the tuples in `ready.json`. Only then attach CUA
   to the recorded bundle. Recheck liveness before every CUA attachment. Do not
   call `getApp`, `getAXState` or any app-opening inspection after Quit: those
   calls can relaunch an exited app with a normal personal profile.
2. On Home, open the composer's project chip and choose **Add project…** to
   open New Project (File/New Session opens Home's composer, not the form). Name
   it exactly `folderProjectName` from the receipt. Keep Local, open the
   normal folder picker, choose `selectedFolder` (spaces and Unicode),
   select the seeded model if needed, and create the project. The controller
   independently checks the resulting Rust project record and selected cwd.
   The picker is the already-live nested **NAC Folder Picker.app**, with identifier
   `ai.arcee.nac.electron.folder-picker.dev` for this dev candidate. Independently
   bind its executable, parent PID and birth before CUA attachment. Do not launch
   that helper bundle yourself or inspect it after cancellation/selection exit.
3. Open the seeded **Native acceptance workspace** chat, then the header's
   **Session menu** (⋯) and its **Files** panel row. If
   the **Files source** status describes a captured revision, select **Back to
   working tree** first and wait for the working-tree source to finish loading.
   Choose **All** (accessible name **All files**) and the exact `revealLeaf`.
   The file is committed, so it does not appear in **Diff** (accessible name
   **Diff of changed files**). Use its normal
   **Reveal in Finder** button. Independently
   observe Finder showing that unique selected leaf. The controller never calls
   `showItemInFolder` or the reveal API. This observation must be recorded by the
   native actor; a controller receipt alone is not Finder evidence.
4. Open **Settings › MCP servers** (Settings…, then MCP servers), select
   **native-browser-fixture**, and click **Authenticate**, then **Continue
   OAuth authorization**. The real system browser opens the local fixture page
   and returns to Rust's callback. Observe the browser page and the NAC
   **Connected** status. This uses dummy local credentials and the existing
   server PKCE/callback owner; it is not vendor authentication qualification.
   The controller independently requires a real external-page browser
   observation with no NAC bridge and one PKCE exchange.
5. Read `status.json`. It must report `folderProjectCreated`, `browserObserved`
   and `pkceSucceeded` true. Exercise ordinary Cmd-Q/Cancel and verify the app
   and private engine remain. Then use ordinary Quit/Stop and Quit. Independently
   observe exact process absence without a post-Quit app inspection.
6. Only after all native observations and ordinary Quit, write the receipt's
   exact `finishShape` to its `finish` file:

   ```sh
   node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(r.finish,JSON.stringify(r.finishShape))' /absolute/private/ready.json
   ```

The controller validates its independent project/browser results, the explicit
native actor receipt, and exact process settlement. It retains `acceptance.json`
and removes its private profile only after success and an unchanged profile-root
identity. On failure/expiry it requests ordinary protected Quit from the exact
live app through the birth-checked observer; the native actor must choose Stop
and Quit. It never forces app termination, bypasses the Quit choice or changes
the Rust shutdown allowance. Unconfirmed cleanup is recorded in
`cleanup-pending.json` and the private profile remains. Browser/Finder windows
created by the native actor are separate OS residuals; close only positively
identified fixture windows if the supported actor can do so safely.

To end an incomplete trial honestly, first use ordinary protected Quit, then write
`{"version":1,"run":"<exact run>","action":"abort","reason":"<bounded concrete limitation>"}`
to its finish file. This deliberately fails acceptance and runs the same cleanup;
it does not claim the missing native observations or delete the retained profile.

The monitor stops reading projects once the required durable project is positively
observed, so normal HTTP retirement during Quit cannot become a false workflow
failure. Its latest sanitized authentication snapshot is retained separately.
`controller-failure.json` preserves the primary exception; cleanup diagnostics never
replace it. If native control races actual process exit, cleanup succeeds only
after the independent birth-checked app/helper/engine census confirms settlement.
An unavailable counter with a still-present PID remains pending and cannot grant
another control attempt, attachment or acceptance.
