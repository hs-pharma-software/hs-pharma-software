/** Clinic sidebar order, Products / Customers removal from clinic only, and
 * that every menu link points at a real page (the Tauri build is a static
 * export, so there are no dynamic routes). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { visibleNavFor, CLINIC_NAV_ORDER } from "@/config/navFilter";
import { moduleAllowedForType, businessType } from "@/config/businessTypes";
import { NAV, type NavChild } from "@/config/nav";

const labels = (type: string, allowed: string[] | null = null, perms: string[] | null = null) => visibleNavFor(type, allowed, perms).map((i) => i.label);

test("clinic sidebar shows exactly these tabs in this order", () => {
  assert.deepEqual(labels("clinic"), [
    "Clinic", "Patients", "Doctors", "Appointments", "Consultation",
    "Invoices", "Staff", "Cash Register", "Banks", "Expenses", "Reports", "Utilities",
  ]);
});

test("clinic: Products and Customers are absent, even if the plan lists them", () => {
  const all = NAV.map((i) => i.moduleKey);
  const withEverything = labels("clinic", all);
  assert.ok(!withEverything.includes("Products"));
  assert.ok(!withEverything.includes("Customers"));
  assert.deepEqual(withEverything, labels("clinic"));
  assert.equal(moduleAllowedForType("clinic", "products"), false);
  assert.equal(moduleAllowedForType("clinic", "customers"), false);
  assert.equal(moduleAllowedForType("clinic", "invoices"), true);
  assert.ok(!businessType("clinic").defaultModules.includes("products"));
  assert.ok(!businessType("clinic").defaultModules.includes("customers"));
});

test("clinic: a staff login only sees the tabs it was given, still in clinic order", () => {
  const perms = ["clinic_appointments", "clinic_patients", "invoices"];
  assert.deepEqual(labels("clinic", null, perms), ["Patients", "Appointments", "Invoices"]);
});

test("Products and Customers stay for the other business types", () => {
  for (const t of ["retail_pharmacy", "medical_store", "hospital_pharmacy", "general_store"]) {
    const l = labels(t);
    assert.ok(l.includes("Products"), `${t} keeps Products`);
    assert.ok(l.includes("Customers"), `${t} keeps Customers`);
    assert.ok(!l.includes("Patients") && !l.includes("Doctors"), `${t} has no clinic tabs`);
  }
  assert.ok(labels("hospital_pharmacy").includes("Rx Inbox"));
  assert.ok(labels("hospital").includes("Labs"));
});

test("clinic order list only names real nav entries", () => {
  const keys = new Set(NAV.map((i) => i.moduleKey));
  for (const k of CLINIC_NAV_ORDER) assert.ok(keys.has(k), `${k} exists in NAV`);
});

function allLinks(children: NavChild[] | undefined): string[] {
  return (children ?? []).flatMap((c) => [c.href, ...allLinks(c.children)]);
}

function pageExists(href: string): boolean {
  const path = href.split("?")[0].replace(/\/$/, "");
  return existsSync(join("src/app", path, "page.tsx"));
}

test("every clinic and hospital menu link opens an existing page", () => {
  for (const type of ["clinic", "hospital", "hospital_pharmacy"]) {
    for (const item of visibleNavFor(type, null, null)) {
      assert.ok(pageExists(item.href), `${type}: ${item.label} -> ${item.href}`);
      for (const href of allLinks(item.children)) assert.ok(pageExists(href), `${type}: ${item.label} -> ${href}`);
    }
  }
});

test("no dynamic [param] routes exist (static export cannot serve them)", () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      if (name.startsWith("[")) found.push(full);
      walk(full);
    }
  };
  walk("src/app");
  assert.deepEqual(found, []);
});
