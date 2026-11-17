"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  ElectronNotificationDelivery,
} = require("../src/notification-delivery.cjs");
const { destination } = require("../src/notification-state.cjs");
function fixture() {
  const instances = [],
    removed = [],
    groups = [];
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    static async getHistory() {
      return instances;
    }
    static remove(ids) {
      removed.push(...ids);
    }
    static removeGroup(group) {
      groups.push(group);
    }
    constructor(options) {
      super();
      Object.assign(this, options);
      this.options = options;
      instances.push(this);
    }
    show() {
      this.shown = true;
    }
    close() {
      this.closed = true;
      this.emit("close");
    }
  }
  const delivery = new ElectronNotificationDelivery({ Notification });
  delivery.shouldPresent = () => true;
  const target = destination("a".repeat(64), "chat", "event");
  return { delivery, Notification, target, instances, removed, groups };
}
test("concrete adapter submits only generic normal notification and bounded profile identity", async () => {
  const f = fixture(),
    clicked = [];
  f.delivery.response = (value) => clicked.push(value);
  assert.deepEqual(await f.delivery.settings(), {
    allowed: true,
    mayRequest: false,
    status: "system-managed",
  });
  const work = f.delivery.add(f.target, "Decision needed"),
    native = f.instances[0];
  assert.equal(native.options.id, f.target.identifier);
  assert.equal(native.options.groupId, `nac-attention-${f.target.profile}`);
  assert.equal(native.options.body, "Open NAC to view current state.");
  assert.equal(native.options.urgency, "normal");
  assert.equal(Object.hasOwn(native.options, "actions"), false);
  assert.equal(Object.hasOwn(native.options, "hasReply"), false);
  native.emit("show");
  assert.equal(await work, true);
  native.emit("click");
  assert.deepEqual(clicked, [f.target]);
  assert.equal(await f.delivery.present(f.target), true);
  f.delivery.withdrawProfile(f.target.profile);
  assert.equal(native.closed, true);
  assert.equal(f.groups[0], `nac-attention-${f.target.profile}`);
  native.emit("click");
  assert.equal(clicked.length, 1);
  f.delivery.retire();
});
test("failure/denial, suppression, retirement and late native callbacks cannot create effects", async () => {
  const f = fixture();
  let clicks = 0;
  f.delivery.response = () => ++clicks;
  let work = f.delivery.add(f.target, "Request completed");
  f.instances[0].emit("failed");
  assert.equal(await work, false);
  work = f.delivery.add(f.target, "Request completed");
  const native = f.instances.at(-1);
  f.delivery.withdraw([f.target.identifier]);
  assert.equal(await work, false);
  native.emit("show");
  native.emit("click");
  assert.equal(clicks, 0);
  f.delivery.shouldPresent = () => false;
  assert.equal(await f.delivery.add(f.target, "Goal completed"), false);
  f.delivery.shouldPresent = () => true;
  work = f.delivery.add(f.target, "Goal completed");
  f.delivery.retire();
  assert.equal(await work, false);
  f.instances.at(-1).emit("show");
  f.instances.at(-1).emit("click");
  assert.equal(clicks, 0);
});
test("late old failure cannot delete successor handle; show race honors focus policy", async () => {
  const f = fixture();
  let work = f.delivery.add(f.target, "Goal completed");
  const old = f.instances[0];
  f.delivery.withdraw([f.target.identifier]);
  assert.equal(await work, false);
  work = f.delivery.add(f.target, "Goal completed");
  const next = f.instances[1];
  old.emit("failed");
  assert.equal(
    f.delivery.notifications.get(f.target.identifier).notification,
    next,
  );
  f.delivery.shouldPresent = () => false;
  next.emit("show");
  assert.equal(await work, false);
  assert.equal(next.closed, true);
  f.delivery.retire();
});
test("optional native permission probe distinguishes denied/pending; history presence never resubmits", async () => {
  const f = fixture();
  f.delivery.permission = {
    async settings() {
      return { allowed: false, mayRequest: true, status: "pending" };
    },
    async authorize() {
      return false;
    },
  };
  assert.equal((await f.delivery.settings()).status, "pending");
  assert.equal(await f.delivery.authorize(), false);
  const history = new f.Notification({
    id: f.target.identifier,
    groupId: `nac-attention-${f.target.profile}`,
  });
  assert.equal(await f.delivery.present(f.target), true);
  assert.equal(history.shown, undefined);
  f.delivery.retire();
});
