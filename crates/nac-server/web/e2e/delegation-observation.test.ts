import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { expect, test } from "vitest";

import { isSqliteObservationLock } from "./delegation-observation";

test("classifies a real read lock without treating a SQL failure as retryable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-observation-lock-"));
  const file = path.join(root, "store.db");
  const writer = new DatabaseSync(file);
  writer.exec("CREATE TABLE probe(value); INSERT INTO probe VALUES (1)");
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    writer.exec("BEGIN EXCLUSIVE");
    let locked: unknown;
    try {
      reader.prepare("SELECT value FROM probe").get();
    } catch (error) {
      locked = error;
    }
    expect(isSqliteObservationLock(locked)).toBe(true);
    writer.exec("ROLLBACK");
    expect(reader.prepare("SELECT value FROM probe").get()?.value).toBe(1);
    let invalid: unknown;
    try {
      reader.prepare("SELECT missing_column FROM probe");
    } catch (error) {
      invalid = error;
    }
    expect(invalid).toBeDefined();
    expect(isSqliteObservationLock(invalid)).toBe(false);
  } finally {
    reader.close();
    writer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recognizes primary and extended locks across realms, rejecting other failures", () => {
  for (const code of [5, 6, 261, 262, 517]) {
    const error: unknown = vm.runInNewContext(
      `Object.assign(new Error('locked'), {errcode: ${code}})`,
    );
    expect(error instanceof Error).toBe(false);
    expect(isSqliteObservationLock(error)).toBe(true);
  }
  for (const error of [
    null,
    "database is locked",
    new Error("database is locked"),
    { errcode: 1 },
    { errcode: 10 },
    { errcode: 14 },
    { errcode: "5" },
    { errcode: -251 },
  ]) {
    expect(isSqliteObservationLock(error)).toBe(false);
  }
});
