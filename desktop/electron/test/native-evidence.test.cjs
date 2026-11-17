"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { identitiesSettled, settleNativeOwner } = require("../e2e/native-evidence.cjs");

const app = { pid: 101, birth_sec: 12, birth_usec: 34 };
const child = { pid: 102, birth_sec: 12, birth_usec: 56 };
test("native cleanup requires conclusive absence or a positively different incarnation", () => {
  assert.equal(identitiesSettled([app], [{ pid: 101, valid: false }], [101]), false);
  assert.equal(identitiesSettled([app], [], [101]), false);
  assert.equal(identitiesSettled([app], [{ pid: 101, valid: false }], []), true);
  assert.equal(identitiesSettled([app], [{ ...app, valid: true }], [101]), false);
  assert.equal(identitiesSettled([app], [{ ...app, valid: true, birth_usec: 99 }], [101]), true);
  assert.equal(identitiesSettled([app, child], [{ ...child, valid: true }], [102]), false);
});
test("native control disappearing during reap still requires independent settlement", async () => {
  let requests = 0,
    captures = 0,
    waits = 0;
  const result = await settleNativeOwner({
    identity: app,
    current: () => ({ ...app, valid: true }),
    capture: () => captures++,
    requestQuit: () => {
      requests++;
      throw new Error("gone during control");
    },
    waitForSettlement: async () => {
      waits++;
      assert.equal(identitiesSettled([app, child], [], []), true);
    },
  });
  assert.deepEqual(result, {
    requested: true,
    controlUnavailable: true,
    independentlySettled: true,
  });
  assert.equal(requests, 1);
  assert.equal(captures, 1);
  assert.equal(waits, 1);
});
test("unknown live or remaining child blocks cleanup and never grants new control", async () => {
  let requests = 0;
  await assert.rejects(
    settleNativeOwner({
      identity: app,
      current: () => ({ pid: app.pid, valid: false }),
      capture: () => {
        throw new Error("unknown root must not capture descendants");
      },
      requestQuit: () => {
        requests++;
      },
      waitForSettlement: async () => {
        throw new Error("unknown live owner pending");
      },
    }),
    /unknown live owner pending/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    settleNativeOwner({
      identity: app,
      current: () => ({ ...app, valid: true }),
      capture: () => {},
      requestQuit: () => {
        requests++;
        throw new Error("observer unavailable");
      },
      waitForSettlement: async () => {
        throw new Error("owned child remains");
      },
    }),
    /owned child remains/,
  );
  assert.equal(requests, 1);
});
