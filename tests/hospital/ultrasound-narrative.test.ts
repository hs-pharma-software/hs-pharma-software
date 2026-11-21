/** Ultrasound reports written out in sentences: what the values make, the
 * doctor's wording kept with the values as entered, and a signed report that
 * cannot change. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { payOrderFee } from "@/lib/repo/hospitalOpd";
import { saveImagingStudy, orderImaging, getRadiologyReport } from "@/lib/repo/radiology";
import { reportStudy } from "@/lib/repo/radiologyPortal";
import { ULTRASOUND_TEMPLATES, parseStructuredReport, ultrasoundTemplate, validateUltrasound, type UsValues } from "@/config/ultrasoundReports";
import {
  NARRATED_SECTIONS, finalizeUltrasound, itemText, narrativeItems, narrativeTitle, narrativeView, suggestedConclusion, toTemplate, tokensOf,
} from "@/config/ultrasoundNarrative";

const MALE = { gender: "Male", reportDate: "2026-11-21" };
const FEMALE = { gender: "Female", reportDate: "2026-11-21" };
const pelvis = ultrasoundTemplate("pelvis")!;
const abdomen = ultrasoundTemplate("abdomen")!;
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

const malePelvis: UsValues = {
  ub_distension: "Well distended", ub_wall: "3", ub_contents: "Anechoic (clear)", ub_stone: "No", ub_mass: "No", ub_prevoid: "350", ub_postvoid: "20",
  pr_l: "3.8", pr_w: "4.2", pr_h: "3.1", pr_echo: "Homogeneous", pr_median: "No",
};

test("every section of every pattern is written out in sentences", () => {
  for (const t of ULTRASOUND_TEMPLATES) for (const s of t.sections) assert.ok(NARRATED_SECTIONS.includes(s.title), `${t.id}: ${s.title}`);
});

test("male pelvis: the title, a paragraph per organ with the entered values, and a normal conclusion", () => {
  assert.equal(narrativeTitle(pelvis, "Male"), "ULTRASOUND REPORT: PELVIS (MALE)");
  const { items } = narrativeItems(pelvis, malePelvis, MALE);
  assert.deepEqual(items.map((i) => i.label), ["Urinary bladder", "Prostate"]);
  const [bladder, prostate] = items.map(itemText);
  assert.equal(bladder, "Well distended with smooth, normal wall thickness (3 mm) and clear anechoic contents. No intraluminal mass or calculus seen. Pre-void bladder volume 350 ml. Post-void residual urine 20 ml (insignificant).");
  assert.match(prostate, /^Measures 3\.8 x 4\.2 x 3\.1 cm, corresponding to a volume of 25\.7 cc\. Normal in size with homogeneous echotexture\. No median lobe protrusion\.$/);
  assert.deepEqual(tokensOf(items[1]).map((t) => t.value), ["3.8", "4.2", "3.1", "25.7 cc"]);
  assert.equal(suggestedConclusion(pelvis, malePelvis, MALE), "Normal sonographic appearance of the visualized pelvic organs. No acute abnormality identified.");
  // The uterus and ovaries never show for a male patient.
  assert.equal(narrativeItems(pelvis, { ...malePelvis, ut_l: "8" }, MALE).items.length, 2);
});

test("abnormal values are described and listed in the suggested conclusion", () => {
  const v: UsValues = {
    lv_span: "17", lv_echo: "Fatty, grade II", lv_lesion: "No", gb_wall: "2", gb_stone: "Yes", gb_stone_count: "One", gb_stone_items: [{ size: "12", location: "Neck" }],
    rk_length: "10.2", rk_width: "4.5", rk_hydro: "Mild", lk_length: "10", ascites: "None", nodes: "No",
  };
  const { items } = narrativeItems(abdomen, v, MALE);
  const liver = itemText(items.find((i) => i.id === "liver")!);
  assert.match(liver, /^Enlarged \(17 cm cranial-caudal span\) with increased echogenicity in keeping with fatty infiltration, grade II\./);
  assert.match(itemText(items.find((i) => i.id === "gall_bladder")!), /Gallstone seen: 12 mm in the neck\. No sludge or polyps seen\./);
  assert.match(itemText(items.find((i) => i.id === "rk")!), /Mild hydronephrosis\. No calculi or focal mass seen\./);
  assert.match(itemText(items.find((i) => i.id === "lk")!), /No calculi, hydronephrosis or focal mass seen\./);
  assert.deepEqual([...new Set(items.map((i) => i.group))], ["Abdominal findings"]);
  assert.equal(suggestedConclusion(abdomen, v, MALE), "Hepatomegaly.\nFatty liver, grade II.\nCholelithiasis.\nMild right hydronephrosis.");
});

test("the doctor rewords a paragraph: the values stay, follow the form, and can't be removed or changed in the text", () => {
  const item = narrativeItems(pelvis, malePelvis, MALE).items[0];
  const edited = "Bladder is well filled; wall 3 mm, smooth. Contents clear. Pre-void 350 ml, residual 20 ml after voiding.";
  const tpl = toTemplate(edited, tokensOf(item));
  assert.equal(tpl, "Bladder is well filled; wall {{ub_wall}} mm, smooth. Contents clear. Pre-void {{ub_prevoid}} ml, residual {{ub_postvoid}} ml after voiding.");
  // A value changed in the form shows in the doctor's wording.
  const v2 = { ...malePelvis, ub_prevoid: "400" };
  const view = narrativeView(pelvis, v2, MALE, { bladder: tpl });
  assert.equal(view.paragraphs[0].text, "Bladder is well filled; wall 3 mm, smooth. Contents clear. Pre-void 400 ml, residual 20 ml after voiding.");
  assert.equal(view.paragraphs[0].error, null);
  // A value typed over in the text (20 -> 15) is a value lost: refused until restored or reset.
  const changed = toTemplate("Bladder is well filled; wall 3 mm. Pre-void 350 ml, residual 15 ml.", tokensOf(item));
  const bad = narrativeView(pelvis, malePelvis, MALE, { bladder: changed }).paragraphs[0];
  assert.match(bad.error ?? "", /keep 20 in the text/);
  assert.throws(() => finalizeUltrasound({ template: "pelvis", values: malePelvis, edits: { bladder: changed } }, MALE, validateUltrasound, clean), /keep 20 in the text/);
  // "3" inside "350" or "3.8" is not the wall's value.
  assert.equal(toTemplate("Pre-void 350 ml, wall 3 mm, residual 20 ml.", tokensOf(item)), "Pre-void {{ub_prevoid}} ml, wall {{ub_wall}} mm, residual {{ub_postvoid}} ml.");
});

test("signing saves the sentences with the doctor's wording; a signed report can't be signed again", async () => {
  const db: DatabaseSync = fullSchemaDb();
  setTestDb(db);
  const T = "rad-a";
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, 'Al Noor Imaging', 'radiology_center', '2026-01-01', '2026-01-01')`).run(T);
  const tenant: SessionTenant = {
    id: T, name: "Al Noor Imaging", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "radiology_center",
  };
  useAuthStore.setState({ currentUser: { id: "owner", username: "owner", displayName: "Dr Umer", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  const s = await saveImagingStudy(null, { name: "Ultrasound Pelvis", modality: "Ultrasound", rate: 1500 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ali Raza", gender: "Male", age_years: 60 });
  const { order } = await orderImaging({ patientId: p.id, serviceId: s.id, orderedBy: "Dr Hamid" });
  await payOrderFee("imaging", order.id, "cash");

  const item = narrativeItems(pelvis, malePelvis, MALE).items[1];
  const edits = { prostate: toTemplate(itemText(item).replace("Normal in size", "Normal size for age"), tokensOf(item)) };
  await reportStudy(order.id, { findings: null, impression: "Normal male pelvis.", structured: { template: "pelvis", values: malePelvis, edits } });
  const report = await getRadiologyReport(order.id);
  const saved = parseStructuredReport(report.order.structured_report)!;
  assert.deepEqual(saved.narrative!.map((x) => x.label), ["Urinary bladder", "Prostate"]);
  assert.match(saved.narrative![1].text, /^Measures 3\.8 x 4\.2 x 3\.1 cm, corresponding to a volume of 25\.7 cc\. Normal size for age with homogeneous echotexture\./);
  assert.match(report.order.findings ?? "", /^SONOGRAPHIC FINDINGS\nUrinary bladder: Well distended/);
  await assert.rejects(
    reportStudy(order.id, { findings: null, impression: "Changed.", structured: { template: "pelvis", values: { ...malePelvis, ub_wall: "9" } } }),
    /signed and released/,
  );
  assert.equal((await getRadiologyReport(order.id)).order.impression, "Normal male pelvis.");
});

test("pregnancy is written out per fetus with its dates", () => {
  const obs = ultrasoundTemplate("obstetric")!;
  const v: UsValues = {
    lmp: "2026-06-01", trimester: "Second", fetus_number: "Single",
    fetuses: [{ presentation: "Cephalic", cardiac: "Present", fhr: "145", movement: "Present", bpd: "48", fl: "33", efw: "450" }],
    pl_site: "Anterior", pl_grade: "I", pl_previa: "Clear of the os", afi: "12", ga_weeks: "24", ga_days: "2",
  };
  const { items } = narrativeItems(obs, v, FEMALE);
  assert.match(itemText(items.find((i) => i.id === "pregnancy")!), /^Single pregnancy in the second trimester\. Last menstrual period 01-06-2026, corresponding to a gestational age of 24 weeks 5 days and an expected date of delivery of 08-03-2027\.$/);
  assert.equal(itemText(items.find((i) => i.id === "fetus_0")!), "Cephalic presentation. Cardiac activity present (fetal heart rate 145 bpm). Fetal movements present. Biometry: BPD 48 mm, FL 33 mm. Estimated fetal weight 450 g.");
  assert.match(itemText(items.find((i) => i.id === "placenta")!), /^Placenta is anterior, grade I, clear of the internal os\. Amniotic fluid index 12 cm \(adequate liquor\)\.$/);
  assert.equal(suggestedConclusion(obs, v, FEMALE), "Single live intrauterine pregnancy of 24 weeks 2 days by scan.");
});
