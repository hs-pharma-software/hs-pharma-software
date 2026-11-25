/** On-screen notices (notify) that replaced the browser alerts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentNotices, dismissNotice, notify, subscribeNotices, toneOf } from "@/lib/notify";

test("the tone follows the wording", () => {
  assert.equal(toneOf("Could not save: network"), "error");
  assert.equal(toneOf("Couldn't open the report"), "error");
  assert.equal(toneOf("Enter the patient's name"), "error");
  assert.equal(toneOf("Upload failed, try again"), "error");
  assert.equal(toneOf("Saved."), "success");
  assert.equal(toneOf("Copied to the clipboard"), "success");
  assert.equal(toneOf("The bill was sent to PRA."), "info");
});

test("notices: shown once, at most four, dismissed by id, listeners told", () => {
  let calls = 0;
  const off = subscribeNotices(() => { calls++; });
  for (const n of currentNotices()) dismissNotice(n.id);
  calls = 0;
  notify("Could not save");
  notify("Could not save");
  assert.equal(currentNotices().length, 1, "the same message twice is shown once");
  assert.equal(currentNotices()[0].tone, "error");
  notify(new Error("Saved"), "success");
  assert.equal(currentNotices()[1].message, "Saved");
  notify("");
  for (let i = 0; i < 6; i++) notify(`Note ${i}`);
  assert.equal(currentNotices().length, 4);
  assert.equal(currentNotices()[3].message, "Note 5");
  dismissNotice(currentNotices()[0].id);
  assert.equal(currentNotices().length, 3);
  assert.ok(calls >= 8);
  off();
});
