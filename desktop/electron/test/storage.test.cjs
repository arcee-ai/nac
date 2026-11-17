"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { PresentationStorage, storageProfile } = require("../src/storage.cjs");
let root, executable, swift;
before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nac-storage-owner-")));
  executable = path.join(root, "checkpoint-helper");
  execFileSync("/usr/bin/xcrun", [
    "clang",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    path.resolve(__dirname, "../src/checkpoint-helper.c"),
    "-o",
    executable,
  ]);
  swift = path.join(root, "swift-writer");
  const runner = path.join(root, "main.swift");
  fs.writeFileSync(
    runner,
    `import Foundation
@main struct Fixture {
  static func main() async throws {
    let args = CommandLine.arguments
    let owner = WorkspaceCheckpoint(home: URL(fileURLWithPath: args[1]), profile: args[2], track: "dev")
    let opened: Bool = await withCheckedContinuation { done in
      owner.load { result in if case .success = result { done.resume(returning: true) } else { done.resume(returning: false) } }
    }
    guard opened else { print("contended"); return }
    let bytes = try Data(contentsOf: URL(fileURLWithPath: args[3]))
    let saved: Bool = await withCheckedContinuation { done in owner.write(bytes) { done.resume(returning: $0) } }
    print(saved ? "saved" : "failed"); fflush(stdout)
    _ = readLine()
    withExtendedLifetime(owner) {}
  }
}`,
  );
  execFileSync("/usr/bin/xcrun", [
    "swiftc",
    "-parse-as-library",
    path.resolve(__dirname, "../../macos/WorkspaceCheckpoint.swift"),
    runner,
    "-o",
    swift,
  ]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture() {
  const home = fs.mkdtempSync(path.join(root, "home-"));
  const configuration = { env: { HOME: home } };
  const receipt = {
    store: path.join(home, "store.db"),
    identity: { track: "dev" },
    endpoint: "http://127.0.0.1:41001",
  };
  const profile = storageProfile(receipt, configuration);
  const directory = path.join(
    home,
    "Library/Application Support/NAC/Presentation/dev",
    profile.digest,
  );
  const open = () => PresentationStorage.open({ receipt, configuration, executable });
  return { home, receipt, configuration, profile, directory, open };
}
function seed(f, version = 1, text = "Review this Swift fixture draft") {
  const values = {
    preferences: { "nac.sidebar.open": "false" },
    drafts: {
      [f.profile.draftKey]: JSON.stringify({
        version: 2,
        binding: Object.values(f.profile.binding),
        drafts: [["fixture-session", text]],
      }),
    },
  };
  const data = JSON.stringify({
    version,
    profile: f.profile.digest,
    values,
    ...(version === 2 ? { native: { notifications: { enabled: false, receipts: [] } } } : {}),
  });
  return { values, data };
}
function install(f, data) {
  fs.mkdirSync(f.directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(f.directory, "checkpoint.json"), data, { mode: 0o600 });
}
function raw(f) {
  const child = spawn(executable, [f.home, "dev", f.profile.digest]);
  let pending = Buffer.alloc(0),
    waiting = [],
    responses = [];
  child.stdout.on("data", (bytes) => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
      const length = pending.readUInt32BE(1),
        result = { status: pending[0], data: pending.subarray(5, 5 + length) };
      pending = pending.subarray(5 + length);
      const resolve = waiting.shift();
      if (resolve) resolve(result);
      else responses.push(result);
    }
  });
  return {
    child,
    next: () =>
      responses.length
        ? Promise.resolve(responses.shift())
        : new Promise((resolve) => waiting.push(resolve)),
    write(data) {
      const bytes = Buffer.from(data),
        header = Buffer.alloc(4);
      header.writeUInt32BE(bytes.length);
      child.stdin.write(Buffer.concat([header, bytes]));
    },
    async close() {
      const closed = once(child, "close");
      child.stdin.end();
      await closed;
    },
  };
}
test("Swift profile digest ignores port/build/incarnation; HOME, stores and tracks isolate", async () => {
  const f = fixture(),
    profile = storageProfile(
      { ...f.receipt, endpoint: "http://127.0.0.1:52002", incarnation: "new" },
      f.configuration,
    );
  assert.equal(profile.digest, f.profile.digest);
  assert.equal(
    profile.digest,
    require("node:crypto")
      .createHash("sha256")
      .update(`nac-presentation-v1\0${f.home}\0dev\0${f.receipt.store}`)
      .digest("hex"),
  );
  assert.notEqual(
    storageProfile({ ...f.receipt, store: path.join(f.home, "two.db") }, f.configuration).digest,
    profile.digest,
  );
  assert.notEqual(
    storageProfile({ ...f.receipt, identity: { track: "stable" } }, f.configuration).digest,
    profile.digest,
  );
  const a = await f.open(),
    b = await f.open();
  const otherStore = await PresentationStorage.open({
    receipt: { ...f.receipt, store: path.join(f.home, "two.db") },
    configuration: f.configuration,
    executable,
  });
  const otherTrack = await PresentationStorage.open({
    receipt: { ...f.receipt, identity: { track: "stable" } },
    configuration: f.configuration,
    executable,
  });
  assert.equal(a.available, true);
  assert.equal(b.available, false);
  assert.equal(otherStore.available, true);
  assert.equal(otherTrack.available, true);
  await otherStore.close();
  await otherTrack.close();
  assert.deepEqual(await b.snapshot(), {
    available: false,
    values: { preferences: {}, drafts: {} },
  });
  await b.close();
  await a.close();
  const c = await f.open();
  assert.equal(c.available, true);
  await c.close();
});
test("actual Swift writer and Electron share flock and versioned v1/v2 bytes in both directions", async () => {
  for (const version of [1, 2]) {
    const f = fixture(),
      seeded = seed(f, version),
      file = path.join(f.home, "fixture.json");
    fs.writeFileSync(file, seeded.data, { mode: 0o600 });
    const writer = spawn(swift, [f.home, f.profile.digest, file]);
    const closed = once(writer, "close");
    assert.equal(String((await once(writer.stdout, "data"))[0]).trim(), "saved");
    const competing = await f.open();
    assert.equal(competing.available, false);
    await competing.close();
    writer.stdin.end();
    await closed;
    const owner = await f.open();
    assert.deepEqual(owner.values, seeded.values);
    assert.equal(
      (await owner.readNotifications(owner.beginNotifications(1))).restored,
      version === 2,
    );
    assert.equal((await owner.write("preferences", "nac.sidebar.open", "true")).durable, true);
    assert.equal((await owner.write("drafts", f.profile.draftKey, null)).durable, true);
    const blocked = spawn(swift, [f.home, f.profile.digest, file]);
    assert.equal(String((await once(blocked.stdout, "data"))[0]).trim(), "contended");
    await once(blocked, "close");
    await owner.close();
    const disk = JSON.parse(fs.readFileSync(path.join(f.directory, "checkpoint.json")));
    assert.deepEqual(disk.values.drafts, {});
    assert.equal(disk.values.preferences["nac.sidebar.open"], "true");
    const reopened = await f.open();
    assert.deepEqual(reopened.values, disk.values);
    await reopened.close();
  }
});
test("each distinct Swift import remains recoverable after parent EOF before exact ACK", async () => {
  const f = fixture();
  for (const text of ["first Swift source", "distinct second Swift source"]) {
    const original = seed(f, 1, text).data;
    install(f, original);
    const helper = raw(f);
    assert.equal((await helper.next()).data.toString(), original);
    helper.write(seed(f, 1, "replacement").data);
    assert.equal((await helper.next()).status, 0);
    await helper.close();
    const sources = fs
      .readdirSync(f.directory)
      .filter((name) => name.startsWith("migration-v1-source-"));
    assert(
      sources.some((name) => fs.readFileSync(path.join(f.directory, name), "utf8") === original),
    );
  }
});
test("native revisions serialize with ordinary clears; stale generation cannot receive late ACK", async () => {
  const f = fixture(),
    owner = await f.open();
  const writes = [],
    releases = [];
  const actual = owner.checkpoint;
  owner.checkpoint = {
    write(bytes) {
      writes.push(JSON.parse(bytes));
      return new Promise((resolve) => releases.push(resolve));
    },
    close: () => actual.close(),
  };
  const token = owner.beginNotifications(1);
  const first = owner.updateNotifications(token, 0, { enabled: false, receipts: [] });
  const clear = owner.write("preferences", "nac.sidebar.open", null);
  const retired = owner.retireNotifications(token); // synchronous fence
  const next = owner.beginNotifications(2);
  assert.equal((await owner.updateNotifications(token, 1, null)).status, "stale");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  const snapshot = await owner.snapshot();
  assert.equal(snapshot.available, false);
  releases.shift()(true);
  assert.equal((await first).status, "stale");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].values.preferences, {});
  let closed = false;
  const closing = owner.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  releases.shift()(true);
  assert.equal((await clear).durable, true);
  await retired;
  await closing;
  assert.equal((await owner.readNotifications(next)).status, "stale");
});
test("ordered exact native revisions preserve opaque state and reject stale expected revision", async () => {
  const f = fixture(),
    owner = await f.open(),
    token = owner.beginNotifications(3);
  const a = owner.updateNotifications(token, 0, { enabled: false, receipts: [] });
  const b = owner.updateNotifications(token, 1, {
    enabled: true,
    receipts: [],
    frontier: "fixture",
    cutoff: "fixture",
  });
  assert.deepEqual(await a, { status: "durable", revision: 1 });
  assert.deepEqual(await b, { status: "durable", revision: 2 });
  assert.equal((await owner.updateNotifications(token, 1, null)).status, "stale");
  assert.deepEqual(await owner.flushNotifications(token), { status: "durable", revision: 2 });
  await owner.close();
  const next = await f.open();
  assert.equal((await next.readNotifications(next.beginNotifications(4))).state.enabled, true);
  await next.close();
});
test("corruption, symlinks, public modes and disk/unlink failures never ACK durable or follow paths", async () => {
  for (const invalid of [
    "{broken",
    JSON.stringify({ version: 9 }),
    JSON.stringify({ version: 1, values: {} }),
  ]) {
    const f = fixture();
    install(f, invalid);
    const owner = await f.open();
    assert.equal(owner.available, false);
    assert.equal((await owner.write("preferences", "nac.sidebar.open", "true")).durable, false);
    assert.equal(fs.readFileSync(path.join(f.directory, "checkpoint.json"), "utf8"), invalid);
    await owner.close();
  }
  const f = fixture(),
    outside = path.join(f.home, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.home, "Library"));
  const rejected = await f.open();
  assert.equal(rejected.available, false);
  assert.deepEqual(fs.readdirSync(outside), []);
  await rejected.close();
  for (const kind of ["public", "symlink", "hardlink"]) {
    const denied = fixture();
    install(denied, seed(denied).data);
    const checkpoint = path.join(denied.directory, "checkpoint.json"),
      target = path.join(denied.home, "private-source.json");
    if (kind === "public") fs.chmodSync(checkpoint, 0o644);
    else {
      fs.renameSync(checkpoint, target);
      if (kind === "symlink") fs.symlinkSync(target, checkpoint);
      else fs.linkSync(target, checkpoint);
    }
    const unavailable = await denied.open();
    assert.equal(unavailable.available, false);
    await unavailable.close();
  }
  const fault = fixture(),
    original = seed(fault).data;
  install(fault, original);
  const owner = await fault.open();
  fs.chmodSync(fault.directory, 0o500);
  assert.equal((await owner.write("drafts", fault.profile.draftKey, null)).durable, false);
  assert.equal(owner.available, false);
  assert.equal((await owner.snapshot()).available, false);
  fs.chmodSync(fault.directory, 0o700);
  await owner.close();
  assert.equal(fs.readFileSync(path.join(fault.directory, "checkpoint.json"), "utf8"), original);
  const helper = raw(fault);
  await helper.next();
  helper.write(seed(fault, 1, "new").data);
  assert.equal((await helper.next()).status, 0);
  fs.chmodSync(fault.directory, 0o500);
  helper.write("");
  assert.equal((await helper.next()).status, 1);
  await once(helper.child, "close");
  fs.chmodSync(fault.directory, 0o700);
  assert(fs.readdirSync(fault.directory).some((name) => name.startsWith("migration-v1-source-")));
});
