import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataLocation, moveExisting } from "../../desktop/src/core/dataLocation.ts";

const quiet = { error: () => undefined, log: () => undefined };

function fakeAppData() {
  const root = mkdtempSync(join(tmpdir(), "mavin-loc-"));
  const appData = join(root, "app");
  mkdirSync(join(appData, "data", "t1", "b1"), { recursive: true });
  mkdirSync(join(appData, "backups"), { recursive: true });
  mkdirSync(join(appData, "secrets"), { recursive: true });
  writeFileSync(join(appData, "device.json"), '{"deviceId":"d1"}');
  writeFileSync(join(appData, "data", "t1", "b1", "mavin.db"), Buffer.alloc(70_000, 7));
  writeFileSync(join(appData, "backups", "mavin-1.db"), "backup");
  writeFileSync(join(appData, "secrets", "device-secret-d1.bin"), "encrypted");
  return { root, appData };
}

test("moving data: every file arrives whole, originals are put aside (never deleted), secrets stay", () => {
  const { root, appData } = fakeAppData();
  const target = join(root, "D", "MAVIN Data");
  mkdirSync(target, { recursive: true });
  moveExisting(appData, target, quiet);
  assert.equal(readFileSync(join(target, "device.json"), "utf8"), '{"deviceId":"d1"}');
  assert.equal(readFileSync(join(target, "data", "t1", "b1", "mavin.db")).length, 70_000);
  assert.equal(readFileSync(join(target, "backups", "mavin-1.db"), "utf8"), "backup");
  assert.ok(!existsSync(join(appData, "device.json")) && !existsSync(join(appData, "data")), "originals no longer used");
  const aside = join(appData, `moved-to-${target.slice(0, 1)}-drive`);
  assert.ok(existsSync(join(aside, "data", "t1", "b1", "mavin.db")), "originals kept aside");
  assert.ok(existsSync(join(appData, "secrets", "device-secret-d1.bin")), "Windows-encrypted secrets stay with the account");
  assert.ok(!existsSync(join(target, "secrets")));
  rmSync(root, { recursive: true, force: true });
});

test("moving data: a data folder that already holds a computer's data is never overwritten", () => {
  const { root, appData } = fakeAppData();
  const target = join(root, "D", "MAVIN Data");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "device.json"), '{"deviceId":"other"}');
  assert.throws(() => moveExisting(appData, target, quiet), /already holds data/);
  assert.equal(readFileSync(join(target, "device.json"), "utf8"), '{"deviceId":"other"}');
  assert.ok(existsSync(join(appData, "device.json")), "nothing moved: the app keeps using its own folder");
  rmSync(root, { recursive: true, force: true });
});

test("data location: a remembered folder is used; a missing one stops the app instead of starting empty", () => {
  const { root, appData } = fakeAppData();
  const target = join(root, "D", "MAVIN Data");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, ".mavin-data"), "x");
  writeFileSync(join(appData, "data-location.json"), JSON.stringify({ path: target }));
  assert.equal(dataLocation(appData, "cashier", quiet), target);
  rmSync(target, { recursive: true, force: true });
  assert.throws(() => dataLocation(appData, "cashier", quiet), /cannot be found/);
  writeFileSync(join(appData, "data-location.json"), JSON.stringify({ path: appData }));
  assert.equal(dataLocation(appData, "cashier", quiet), appData, "a computer with only C: stays where it is");
  rmSync(root, { recursive: true, force: true });
});
