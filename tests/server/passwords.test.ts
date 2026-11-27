/** Passwords: new ones are stored as scrypt; old SHA-256 ones still sign in
 * and are marked for saving again as scrypt. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPassword, passwordHash, storedPasswordHash } from "@/server/db";

test("a new password is stored as scrypt and checks", () => {
  const stored = storedPasswordHash("Secret#123", "salt1");
  assert.match(stored, /^scrypt\$16384\$[0-9a-f]{64}$/);
  assert.deepEqual(checkPassword("Secret#123", "salt1", stored), { ok: true, upgrade: false });
  assert.equal(checkPassword("secret#123", "salt1", stored).ok, false, "wrong password");
  assert.equal(checkPassword("Secret#123", "salt2", stored).ok, false, "other salt");
  assert.notEqual(storedPasswordHash("Secret#123", "salt2"), stored);
});

test("an old SHA-256 password still signs in and is marked for upgrade", () => {
  const old = passwordHash("Secret#123", "salt1");
  assert.deepEqual(checkPassword("Secret#123", "salt1", old), { ok: true, upgrade: true });
  assert.deepEqual(checkPassword("wrong", "salt1", old), { ok: false, upgrade: false });
});

test("a damaged stored value never matches", () => {
  for (const bad of ["", "scrypt$", "scrypt$abc$00", "scrypt$16384$", "scrypt$99999999$00", "scrypt$16384$abc"]) {
    assert.equal(checkPassword("x", "s", bad).ok, false, bad);
  }
});
