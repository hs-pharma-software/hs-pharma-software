/** Hospital sidebar: exact order, the nested Purchase Cell / Billing / HR groups,
 * permissions on parents and children, no duplicate entries, real pages. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { visibleNavFor } from "@/config/navFilter";
import { moduleKeyForPath, hasPermission } from "@/lib/moduleAccess";
import type { NavChild, NavItem } from "@/config/nav";

const nav = (allowed: string[] | null = null, perms: string[] | null = null) => visibleNavFor("hospital", allowed, perms);
const top = (n: NavItem[]) => n.map((i) => i.label);
const kids = (item: NavItem | undefined) => (item?.children ?? []).map((c) => c.label);
const find = (n: NavItem[], label: string) => n.find((i) => i.label === label);

test("hospital sidebar: the ten tabs in the requested order", () => {
  assert.deepEqual(top(nav()), [
    "Dashboard", "Hospital", "Patient", "Episodes & Billing", "Departments", "Labs", "Radiology", "Service Master", "Purchase Cell", "HR Department",
  ]);
});

test("Episodes & Billing holds Episodes and Billing; Invoices is reachable through Billing, not top level", () => {
  const n = nav();
  assert.deepEqual(kids(find(n, "Episodes & Billing")), ["Episodes", "Billing"]);
  const billing = find(n, "Episodes & Billing")!.children!.find((c) => c.label === "Billing")!;
  assert.equal(billing.href, "/invoices");
  assert.deepEqual((billing.children ?? []).map((c) => c.href), ["/invoices", "/invoices/returns", "/invoices/item-return", "/invoices/memorized"]);
  assert.ok(!top(n).includes("Invoices"));
});

test("Purchase Cell sub-tabs, exact order, each keeping its existing pages", () => {
  const pc = find(nav(), "Purchase Cell")!;
  assert.deepEqual(kids(pc), ["Products", "Supplier", "Cash Register", "Banks", "Expenses", "Other Revenue", "Tasks", "Utilities"]);
  const byLabel = (l: string) => pc.children!.find((c) => c.label === l)!;
  assert.equal(byLabel("Products").href, "/products");
  assert.ok(byLabel("Products").children!.some((c) => c.href === "/products/uom"));
  assert.equal(byLabel("Supplier").href, "/suppliers");
  assert.equal(byLabel("Cash Register").href, "/cash-register");
  assert.ok(byLabel("Banks").children!.some((c) => c.href === "/banks/statement"));
  assert.ok(byLabel("Expenses").children!.some((c) => c.href === "/expenses/salary"));
  assert.ok(byLabel("Other Revenue").children!.some((c) => c.href === "/other-revenue/categories"));
  assert.equal(byLabel("Tasks").href, "/tasks");
  assert.ok(byLabel("Utilities").children!.some((c) => c.href === "/utilities/financial-closing"));
});

test("HR Department holds Staff", () => {
  const hr = find(nav(), "HR Department")!;
  assert.deepEqual(kids(hr), ["Staff"]);
  const staff = hr.children![0];
  assert.equal(staff.href, "/staff");
  assert.deepEqual((staff.children ?? []).map((c) => c.href), ["/staff", "/staff/ledger", "/staff/attendance"]);
  for (const moved of ["Staff", "Products", "Banks", "Expenses", "Cash Register", "Utilities", "Tasks", "Other Revenue", "Suppliers", "Reports"]) {
    assert.ok(!top(nav()).includes(moved), `${moved} is not top level`);
  }
});

test("the Hospital tab keeps the queue pages, now on their own routes", () => {
  const h = find(nav(), "Hospital")!;
  assert.deepEqual(h.children!.map((c) => c.href), ["/hospital/profile", "/hospital/opd", "/hospital/ipd", "/hospital/emergency"]);
});

test("no duplicate entries: labels unique per level, no link repeated across the whole menu", () => {
  const n = nav();
  assert.equal(new Set(top(n)).size, n.length);
  const seen = new Map<string, string>();
  const walk = (children: NavChild[] | undefined, path: string) => {
    const labels = (children ?? []).map((c) => c.label);
    assert.equal(new Set(labels).size, labels.length, `unique labels under ${path}`);
    for (const c of children ?? []) {
      if (c.children) walk(c.children, `${path}/${c.label}`);
      else {
        const prev = seen.get(c.href);
        assert.equal(prev, undefined, `${c.href} appears under both ${prev} and ${path}/${c.label}`);
        seen.set(c.href, `${path}/${c.label}`);
      }
    }
  };
  for (const item of n) walk(item.children, item.label);
});

test("permissions: a group key grants all its sub-tabs; a child key grants just that one; none hides the group", () => {
  const pc = (perms: string[]) => find(nav(null, perms), "Purchase Cell");
  assert.equal(kids(pc(["hospital_purchase_cell"])).length, 8);
  assert.deepEqual(kids(pc(["banks"])), ["Banks"]);
  assert.deepEqual(kids(pc(["products", "tasks"])), ["Products", "Tasks"]);
  assert.equal(pc(["hospital_patients"]), undefined, "no key for any Purchase Cell child: group hidden");
  assert.deepEqual(top(nav(null, [])), []);
  assert.deepEqual(top(nav(null, ["hospital_patients", "hospital_hr"])), ["Patient", "HR Department"]);
  // Billing needs the invoices key (or the Episodes & Billing group key).
  assert.deepEqual(kids(find(nav(null, ["hospital_episodes"]), "Episodes & Billing")), ["Episodes", "Billing"]);
  assert.deepEqual(kids(find(nav(null, ["invoices"]), "Episodes & Billing")), ["Billing"]);
});

test("the subscription plan still limits the shared sub-tabs, not the hospital's own tabs", () => {
  const n = nav(["products", "banks"]);
  assert.deepEqual(kids(find(n, "Purchase Cell")), ["Products", "Banks"]);
  assert.equal(find(n, "HR Department"), undefined, "staff is not in this plan");
  assert.ok(find(n, "Patient") && find(n, "Labs"), "hospital sections are not plan-limited");
});

test("other business types do not get the hospital menu and keep Invoices / Staff at top level", () => {
  for (const t of ["retail_pharmacy", "hospital_pharmacy", "general_store"]) {
    const l = visibleNavFor(t, null, null).map((i) => i.label);
    assert.ok(l.includes("Invoices") && l.includes("Staff"), t);
    for (const h of ["Purchase Cell", "HR Department", "Episodes & Billing", "Labs"]) assert.ok(!l.includes(h), `${t} has no ${h}`);
  }
});

test("every hospital link, nested ones included, opens an existing page", () => {
  const links = (children: NavChild[] | undefined): string[] => (children ?? []).flatMap((c) => [c.href, ...links(c.children)]);
  for (const item of nav()) {
    for (const href of [item.href, ...links(item.children)]) {
      assert.ok(existsSync(join("src/app", href.split("?")[0].replace(/\/$/, ""), "page.tsx")), `${item.label} -> ${href}`);
    }
  }
});

test("route guards agree with the menu: every visible link is allowed for exactly the users who see it", () => {
  const links = (children: NavChild[] | undefined): string[] => (children ?? []).flatMap((c) => [c.href, ...links(c.children)]);
  const cases = [["hospital_purchase_cell"], ["banks"], ["hospital_hr"], ["hospital_episodes"], ["invoices"], ["hospital_patients", "products"]];
  for (const perms of cases) {
    for (const item of nav(null, perms)) {
      // A group header only expands; the links are its children.
      for (const href of item.children ? links(item.children) : [item.href]) {
        const key = moduleKeyForPath(href.split("?")[0]);
        assert.ok(key && hasPermission(perms, key), `${perms.join("+")} sees ${item.label} -> ${href} (guarded by ${key})`);
      }
    }
  }
});

test("route guards deny what the menu hides", () => {
  assert.equal(hasPermission(["hospital_patients"], "products"), false);
  assert.equal(hasPermission(["hospital_patients"], "banks"), false);
  assert.equal(hasPermission(["banks"], "products"), false);
  assert.equal(hasPermission(["hospital_purchase_cell"], "staff"), false, "HR is a different group");
  assert.equal(hasPermission(["hospital_hr"], "staff"), true);
  assert.equal(hasPermission(["hospital_purchase_cell"], "products"), true);
});

test("route keys: queue pages follow Episodes, shared pages keep their own key", () => {
  assert.equal(moduleKeyForPath("/hospital/opd"), "hospital_episodes");
  assert.equal(moduleKeyForPath("/hospital/emergency/"), "hospital_episodes");
  assert.equal(moduleKeyForPath("/hospital/profile"), "hospital_profile");
  assert.equal(moduleKeyForPath("/hospital"), "hospital_dashboard");
  assert.equal(moduleKeyForPath("/products/uom"), "products");
  assert.equal(moduleKeyForPath("/banks/statement"), "banks");
  assert.equal(moduleKeyForPath("/staff/attendance"), "staff");
  assert.equal(moduleKeyForPath("/invoices/returns"), "invoices");
});
