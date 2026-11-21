/** Ultrasound reports written out in sentences ("Liver: Normal in size (14 cm
 * cranial-caudal span) ..."), from the values the doctor entered.
 *
 * The doctor may reword any paragraph before signing, but the entered values
 * stay as entered: an edited paragraph is kept with each value as a marker
 * ({{key}}), so a value can only be changed in the form, and a paragraph that
 * lost one of its values cannot be signed. Pure code: the reporting screen, the
 * save (online and offline) and the tests share it. */
import {
  fieldShown, rangeFlag, sectionShown, ultrasoundTemplate,
  type StructuredReport, type UsContext, type UsField, type UsRow, type UsSection, type UsTemplate, type UsValue, type UsValues,
} from "./ultrasoundReports.ts";

/** A piece of a sentence: words, or an entered value. */
export type Part = string | { key: string; value: string };
export interface NarrativeItem { id: string; group: string; label: string; parts: Part[] }
/** A signed paragraph, as printed. */
export interface NarrativeParagraph { id: string; group: string; label: string; text: string }

const text = (v: UsValue | undefined) => (typeof v === "string" ? v.trim() : "");
const num = (v: UsValue | undefined) => {
  const t = text(v);
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const dmy = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : d);
/** "a, b or c" */
const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** The report's title, e.g. "ULTRASOUND REPORT: PELVIS (MALE)". */
export function narrativeTitle(t: UsTemplate, gender: string | null): string {
  const names: Record<string, string> = { kub: "KUB (kidneys, ureters and bladder)", obstetric: "Obstetric", abdomen: "Abdomen and pelvis", pelvis: "Pelvis" };
  const sex = t.id === "pelvis" && gender ? (/^f/i.test(gender) ? " (female)" : /^m/i.test(gender) ? " (male)" : "") : "";
  return `Ultrasound report: ${names[t.id] ?? t.name}${sex}`.toUpperCase();
}

// ── Writing the sentences ─────────────────────────────────────────────────

class Writer {
  parts: Part[] = [];
  private v: UsValues;
  private fields: Map<string, UsField>;
  private ctx: UsContext;
  constructor(v: UsValues, fields: Map<string, UsField>, ctx: UsContext) {
    this.v = v;
    this.fields = fields;
    this.ctx = ctx;
  }
  /** Words. */
  w(s: string) { if (s) this.parts.push(s); return this; }
  /** An entered value, as a value the doctor's edits must keep. */
  val(key: string, value?: string) {
    const f = this.fields.get(key);
    const raw = value ?? (f?.type === "computed" ? f.compute?.(this.v, this.ctx) ?? "" : text(this.v[key]));
    const shown = f?.type === "date" || (f?.type === "computed" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) ? dmy(raw) : raw;
    if (shown) this.parts.push({ key, value: shown });
    return this;
  }
  get empty() { return !this.parts.some((p) => (typeof p === "string" ? p.trim() : p.value)); }
}

interface Ctx {
  v: UsValues;
  ctx: UsContext;
  s: (key: string) => string;
  n: (key: string) => number | null;
  has: (key: string) => boolean;
  flag: (key: string) => "High" | "Low" | null;
  rows: (key: string) => UsRow[];
  write: () => Writer;
  issue: (s: string) => void;
  item: (id: string, label: string, w: Writer) => void;
}

/** Sizes and places of a Yes/No finding's rows: "6 mm in the lower pole calyx; 4 mm in the renal pelvis". */
function sizedRows(c: Ctx, w: Writer, listKey: string, joiner: (location: string) => string) {
  c.rows(listKey).forEach((r, i) => {
    if (i) w.w("; ");
    if (text(r.size)) w.val(`${listKey}.${i}.size`, text(r.size)).w(" mm");
    if (text(r.location)) w.w(joiner(lower(text(r.location))));
  });
}

const yesNo = (c: Ctx, key: string) => c.s(key) === "Yes";

function kidney(c: Ctx, p: string, side: string) {
  const w = c.write();
  const [L, W] = [c.has(`${p}_length`), c.has(`${p}_width`)];
  if (L || W) {
    w.w("Measures ");
    if (L) w.val(`${p}_length`);
    if (L && W) w.w(" x ");
    if (W) w.val(`${p}_width`);
    w.w(" cm");
    if (c.has(`${p}_cortex`)) w.w(" with parenchymal thickness of ").val(`${p}_cortex`).w(" cm");
    w.w(". ");
  }
  const size = c.flag(`${p}_length`);
  if (size) c.issue(`${size === "High" ? "Enlarged" : "Small"} ${side.toLowerCase()} kidney.`);
  const echo = c.s(`${p}_echo`);
  if (echo === "Increased" || echo === "Decreased") c.issue(`${echo} ${side.toLowerCase()} renal cortical echogenicity.`);
  w.w(`${size === "High" ? "Enlarged" : size === "Low" ? "Small in size" : "Normal size"}, smooth contour and ${echo === "Increased" ? "increased" : echo === "Decreased" ? "decreased" : "normal"} cortical echogenicity.`);
  const cmd = c.s(`${p}_cmd`);
  w.w(` Corticomedullary differentiation is ${cmd === "Reduced" ? "reduced" : cmd === "Lost" ? "lost" : "intact"}.`);
  if (cmd === "Reduced" || cmd === "Lost") c.issue(`${cmd} corticomedullary differentiation of the ${side.toLowerCase()} kidney.`);
  const stone = yesNo(c, `${p}_stone`);
  const hydro = c.s(`${p}_hydro`);
  const hydroShown = hydro && hydro !== "None";
  const [cyst, mass] = [yesNo(c, `${p}_cyst`), yesNo(c, `${p}_mass`)];
  if (stone) {
    const many = c.s(`${p}_stone_count`) === "Multiple";
    w.w(many ? " Calculi seen: " : " Calculus seen: ");
    sizedRows(c, w, `${p}_stone_items`, (l) => ` in the ${l}`);
    w.w(".");
    c.issue(`${side} renal ${many ? "calculi" : "calculus"}.`);
  }
  if (hydroShown) { w.w(` ${hydro} hydronephrosis.`); c.issue(`${hydro} ${side.toLowerCase()} hydronephrosis.`); }
  if (cyst) { w.w(" Cyst seen"); if (c.has(`${p}_cyst_detail`)) w.w(": ").val(`${p}_cyst_detail`); w.w("."); c.issue(`${side} renal cyst.`); }
  if (mass) { w.w(" Mass seen"); if (c.has(`${p}_mass_detail`)) w.w(": ").val(`${p}_mass_detail`); w.w("."); c.issue(`${side} renal mass.`); }
  const none = [!stone && "calculi", !hydroShown && "hydronephrosis", !mass && "focal mass"].filter(Boolean) as string[];
  if (none.length) w.w(` No ${orList(none)} seen.`);
  c.item(p, `${side} kidney`, w);
}

const NARRATORS: Record<string, (c: Ctx) => void> = {
  "Right kidney": (c) => kidney(c, "rk", "Right"),
  "Left kidney": (c) => kidney(c, "lk", "Left"),

  Ureters: (c) => {
    const w = c.write();
    const [r, l] = [yesNo(c, "ur_right"), yesNo(c, "ur_left")];
    if (!r && !l) w.w("Both ureters are not dilated.");
    else if (r && l) { w.w("Both ureters are dilated."); c.issue("Bilateral hydroureter."); }
    else { w.w(`${r ? "Right" : "Left"} ureter is dilated; ${r ? "left" : "right"} ureter is not dilated.`); c.issue(`${r ? "Right" : "Left"} hydroureter.`); }
    if (yesNo(c, "ur_stone")) {
      w.w(" Ureteric calculus seen: ");
      sizedRows(c, w, "ur_stone_items", (l) => ` at the ${l}${/junction/.test(l) ? "" : " ureter"}`);
      w.w(".");
      c.issue("Ureteric calculus.");
    } else w.w(" No ureteric calculus seen.");
    c.item("ureters", "Ureters", w);
  },

  "Urinary bladder": (c) => {
    const w = c.write();
    const d = c.s("ub_distension");
    w.w(d === "Partially distended" ? "Partially distended" : d === "Empty" ? "Empty" : "Well distended");
    if (c.has("ub_wall")) {
      const thick = c.flag("ub_wall") === "High";
      w.w(thick ? " with thickened wall (" : " with smooth, normal wall thickness (").val("ub_wall").w(" mm)");
      if (thick) c.issue("Thickened urinary bladder wall.");
    }
    const contents = c.s("ub_contents");
    if (contents === "Internal echoes" || contents === "Debris") { w.w(` and ${lower(contents)} in the lumen.`); c.issue(`${contents} in the urinary bladder.`); }
    else w.w(" and clear anechoic contents.");
    const [stone, mass] = [yesNo(c, "ub_stone"), yesNo(c, "ub_mass")];
    if (stone) {
      w.w(c.s("ub_stone_count") === "Multiple" ? " Calculi seen: " : " Calculus seen: ");
      sizedRows(c, w, "ub_stone_items", (l) => ` at the ${l}`);
      w.w(".");
      c.issue("Urinary bladder calculus.");
    }
    if (mass) { w.w(" Mass seen"); if (c.has("ub_mass_detail")) w.w(": ").val("ub_mass_detail"); w.w("."); c.issue("Urinary bladder mass."); }
    if (!stone && !mass) w.w(" No intraluminal mass or calculus seen.");
    else if (!stone) w.w(" No calculus seen.");
    else if (!mass) w.w(" No intraluminal mass seen.");
    if (c.has("ub_prevoid")) w.w(" Pre-void bladder volume ").val("ub_prevoid").w(" ml.");
    if (c.has("ub_postvoid")) {
      const high = c.flag("ub_postvoid") === "High";
      w.w(" Post-void residual urine ").val("ub_postvoid").w(high ? " ml (significant)." : " ml (insignificant).");
      if (high) c.issue("Significant post-void residual urine.");
    }
    c.item("bladder", "Urinary bladder", w);
  },

  Prostate: (c) => {
    const w = c.write();
    const dims = ["pr_l", "pr_w", "pr_h"].filter((k) => c.has(k));
    if (dims.length) {
      w.w("Measures ");
      dims.forEach((k, i) => { if (i) w.w(" x "); w.val(k); });
      w.w(" cm");
      const vol = c.write().val("pr_volume");
      if (!vol.empty) w.w(", corresponding to a volume of ").val("pr_volume");
      w.w(". ");
    }
    const [l, wd, h] = [c.n("pr_l"), c.n("pr_w"), c.n("pr_h")];
    const volume = l && wd && h ? 0.52 * l * wd * h : null;
    const enlarged = volume != null && volume > 30;
    if (enlarged) c.issue("Enlarged prostate.");
    const echo = c.s("pr_echo");
    if (echo === "Heterogeneous") c.issue("Heterogeneous prostatic echotexture.");
    w.w(`${enlarged ? "Enlarged" : "Normal in size"} with ${echo === "Heterogeneous" ? "heterogeneous" : "homogeneous"} echotexture.`);
    if (yesNo(c, "pr_median")) { w.w(" Median lobe protrudes into the bladder base."); c.issue("Median lobe protrusion."); }
    else w.w(" No median lobe protrusion.");
    c.item("prostate", "Prostate", w);
  },

  Liver: (c) => {
    const w = c.write();
    const big = c.flag("lv_span") === "High";
    w.w(big ? "Enlarged" : "Normal in size");
    if (c.has("lv_span")) w.w(" (").val("lv_span").w(" cm cranial-caudal span)");
    if (big) c.issue("Hepatomegaly.");
    const echo = c.s("lv_echo");
    if (/^Fatty/.test(echo)) { w.w(` with increased echogenicity in keeping with fatty infiltration, ${lower(echo.replace(/^Fatty, /, ""))}.`); c.issue(`Fatty liver, ${lower(echo.replace(/^Fatty, /, ""))}.`); }
    else if (echo === "Coarse") { w.w(" with coarse parenchymal echotexture."); c.issue("Coarse hepatic echotexture."); }
    else w.w(", shape and homogeneous parenchymal echotexture. Smooth surface contour.");
    if (yesNo(c, "lv_lesion")) { w.w(" Focal lesion seen"); if (c.has("lv_lesion_detail")) w.w(": ").val("lv_lesion_detail"); w.w("."); c.issue("Focal liver lesion."); }
    else w.w(" No focal mass, cyst or intrahepatic biliary duct dilatation.");
    if (c.has("pv")) {
      const wide = c.flag("pv") === "High";
      w.w(wide ? " Main portal vein is dilated (" : " Main portal vein is patent with normal hepatopetal flow (").val("pv").w(" mm).");
      if (wide) c.issue("Dilated portal vein.");
    }
    c.item("liver", "Liver", w);
  },

  "Gall bladder and bile ducts": (c) => {
    const w = c.write();
    if (c.has("gb_wall")) {
      const thick = c.flag("gb_wall") === "High";
      w.w(thick ? "Wall is thickened (" : "Adequately distended with normal wall thickness (").val("gb_wall").w(" mm). ");
      if (thick) c.issue("Thickened gall bladder wall.");
    }
    const [stone, sludge, polyp] = [yesNo(c, "gb_stone"), yesNo(c, "gb_sludge"), yesNo(c, "gb_polyp")];
    if (stone) {
      w.w(c.s("gb_stone_count") === "Multiple" ? "Gallstones seen: " : "Gallstone seen: ");
      sizedRows(c, w, "gb_stone_items", (l) => ` in the ${l}`);
      w.w(". ");
      c.issue("Cholelithiasis.");
    }
    if (sludge) { w.w("Sludge seen. "); c.issue("Gall bladder sludge."); }
    if (polyp) { w.w("Polyp seen. "); c.issue("Gall bladder polyp."); }
    const none = [!stone && "gallstones", !sludge && "sludge", !polyp && "polyps"].filter(Boolean) as string[];
    if (none.length) w.w(`No ${orList(none)} seen.`);
    if (c.has("cbd")) {
      const wide = c.flag("cbd") === "High";
      w.w(wide ? " Common bile duct is dilated (" : " Common bile duct is normal in caliber (").val("cbd").w(" mm).");
      if (wide) c.issue("Dilated common bile duct.");
    }
    c.item("gall_bladder", "Gall bladder and biliary tree", w);
  },

  "Pancreas and spleen": (c) => {
    const pan = c.s("pan");
    if (pan) {
      const w = c.write();
      if (pan === "Bulky") { w.w("Bulky in size."); c.issue("Bulky pancreas."); }
      else if (pan === "Atrophic") { w.w("Atrophic."); c.issue("Atrophic pancreas."); }
      else if (pan === "Obscured by bowel gas") w.w("Not well visualized; obscured by overlying bowel gas.");
      else w.w("Visualized head, body and tail show normal size, shape and echogenicity. No focal lesion, calcification or pancreatic duct dilatation.");
      c.item("pancreas", "Pancreas", w);
    }
    if (c.has("sp_size") || c.has("sp_echo")) {
      const w = c.write();
      const big = c.flag("sp_size") === "High";
      w.w(big ? "Enlarged" : "Normal in size");
      if (c.has("sp_size")) w.w(" (").val("sp_size").w(" cm bipolar length)");
      if (big) c.issue("Splenomegaly.");
      if (c.s("sp_echo") === "Abnormal") { w.w(" with abnormal echotexture."); c.issue("Abnormal splenic echotexture."); }
      else w.w(", shape and homogeneous echotexture without focal lesion.");
      c.item("spleen", "Spleen", w);
    }
  },

  Peritoneum: (c) => {
    const w = c.write();
    const a = c.s("ascites");
    if (a && a !== "None") { w.w(`${a === "Gross" ? "Gross" : a} ascites.`); c.issue(`${a} ascites.`); }
    else w.w("No free intraperitoneal fluid (ascites).");
    if (yesNo(c, "nodes")) { w.w(" Enlarged lymph nodes seen."); c.issue("Abdominal lymphadenopathy."); }
    else w.w(" No significant abdominal lymphadenopathy.");
    c.item("peritoneum", "Peritoneum", w);
  },

  Uterus: (c) => {
    const w = c.write();
    const pos = c.s("ut_position");
    w.w(pos ? `${pos} uterus` : "Uterus");
    const dims = ["ut_l", "ut_w", "ut_ap"].filter((k) => c.has(k));
    if (dims.length) {
      w.w(" measuring ");
      dims.forEach((k, i) => { if (i) w.w(" x "); w.val(k); });
      w.w(" cm");
    }
    const het = c.s("ut_echo") === "Heterogeneous";
    w.w(`. Myometrial echotexture is ${het ? "heterogeneous" : "homogeneous"}.`);
    if (het) c.issue("Heterogeneous myometrium.");
    if (yesNo(c, "fibroid")) {
      const many = c.s("fibroid_count") === "Multiple";
      w.w(many ? " Fibroids seen: " : " Fibroid seen: ");
      sizedRows(c, w, "fibroid_items", (l) => `, ${l}`);
      w.w(".");
      c.issue(many ? "Uterine fibroids." : "Uterine fibroid.");
    } else w.w(" No fibroid seen.");
    if (c.has("endo")) w.w(" Endometrial thickness ").val("endo").w(" mm.");
    c.item("uterus", "Uterus", w);
  },

  "Ovaries and adnexa": (c) => {
    for (const [p, side] of [["ro", "Right"], ["lo", "Left"]] as const) {
      if (!c.has(`${p}_size`) && !c.has(`${p}_cyst`)) continue;
      const w = c.write();
      if (c.has(`${p}_size`)) w.w("Measures ").val(`${p}_size`).w(" cm. ");
      if (yesNo(c, `${p}_cyst`)) {
        w.w(c.s(`${p}_cyst_count`) === "Multiple" ? "Cysts seen measuring " : "Cyst seen measuring ");
        c.rows(`${p}_cyst_items`).forEach((r, i) => { if (i) w.w(" and "); if (text(r.size)) w.val(`${p}_cyst_items.${i}.size`, text(r.size)).w(" mm"); });
        w.w(".");
        c.issue(`${side} ovarian cyst.`);
      } else w.w("Normal in appearance with no cyst or mass seen.");
      c.item(p, `${side} ovary`, w);
    }
    if (c.has("pod")) {
      const w = c.write();
      if (yesNo(c, "pod")) { w.w("Free fluid seen in the pouch of Douglas."); c.issue("Free fluid in the pouch of Douglas."); }
      else w.w("No free fluid in the pouch of Douglas.");
      c.item("pod", "Pouch of Douglas", w);
    }
  },

  Pregnancy: (c) => {
    const w = c.write();
    const fetuses = c.s("fetus_number");
    const tri = c.s("trimester");
    if (fetuses || tri) {
      const kind = { Single: "Single", Twins: "Twin", Triplets: "Triplet", "More than three": "Multiple" }[fetuses] ?? "";
      w.w(`${kind ? `${kind} pregnancy` : "Pregnancy"}${tri ? ` in the ${tri.toLowerCase()} trimester` : ""}. `);
    }
    if (c.has("lmp")) {
      w.w("Last menstrual period ").val("lmp");
      const ga = c.write().val("ga_lmp");
      if (!ga.empty) w.w(", corresponding to a gestational age of ").val("ga_lmp");
      const edd = c.write().val("edd_lmp");
      if (!edd.empty) w.w(" and an expected date of delivery of ").val("edd_lmp");
      w.w(".");
    }
    c.item("pregnancy", "Pregnancy", w);
  },

  "Early pregnancy": (c) => {
    const w = c.write();
    const sac = c.s("sac_site");
    if (sac === "Intrauterine" || (!sac && c.has("msd"))) {
      w.w(sac ? "Intrauterine gestational sac seen" : "Gestational sac");
      if (c.has("msd")) w.w(" with mean sac diameter of ").val("msd").w(" mm");
      w.w(".");
    } else if (sac === "Not seen") { w.w("No intrauterine gestational sac seen."); c.issue("No intrauterine gestational sac seen."); }
    else if (sac === "Ectopic suspected") { w.w("No definite intrauterine gestational sac; ectopic pregnancy suspected."); c.issue("Suspected ectopic pregnancy."); }
    const yolk = c.s("yolk");
    if (yolk) w.w(` Yolk sac is ${yolk === "Seen" ? "seen" : "not seen"}.`);
    const pole = c.s("fetal_pole");
    if (pole === "Seen" || (!pole && c.has("crl"))) {
      w.w(pole ? " Fetal pole is seen" : " Fetal pole");
      if (c.has("crl")) w.w(" with crown rump length of ").val("crl").w(" mm");
      w.w(".");
    } else if (pole === "Not seen") w.w(" Fetal pole is not seen.");
    const cardiac = c.s("early_cardiac");
    if (cardiac === "Present") {
      w.w(" Fetal cardiac activity is present");
      if (c.has("early_fhr")) w.w(" (fetal heart rate ").val("early_fhr").w(" bpm)");
      w.w(".");
    } else if (cardiac === "Absent") { w.w(" Fetal cardiac activity is absent."); c.issue("No fetal cardiac activity."); }
    else if (cardiac) w.w(" Too early to assess cardiac activity.");
    if (c.has("nt")) {
      const high = c.flag("nt") === "High";
      w.w(" Nuchal translucency ").val("nt").w(high ? " mm (increased)." : " mm.");
      if (high) c.issue("Increased nuchal translucency.");
    }
    c.item("early", "Early pregnancy", w);
  },

  "Fetal assessment": (c) => {
    const rows = c.rows("fetuses");
    rows.forEach((r, i) => {
      const w = c.write();
      const key = (col: string) => `fetuses.${i}.${col}`;
      const of = rows.length > 1 ? ` (fetus ${i + 1})` : "";
      if (text(r.presentation)) w.w(`${text(r.presentation)} presentation. `);
      if (text(r.cardiac) === "Present") {
        w.w("Cardiac activity present");
        if (text(r.fhr)) {
          w.w(" (fetal heart rate ").val(key("fhr"), text(r.fhr)).w(" bpm)");
          const f = rangeFlag(r.fhr, { min: 110, max: 160 });
          if (f) c.issue(`Fetal ${f === "High" ? "tachycardia" : "bradycardia"}${of}.`);
        }
        w.w(". ");
      } else if (text(r.cardiac) === "Absent") { w.w("Cardiac activity absent. "); c.issue(`No fetal cardiac activity${of}.`); }
      if (text(r.movement)) w.w(`Fetal movements ${text(r.movement).toLowerCase()}. `);
      if (text(r.movement) && text(r.movement) !== "Present") c.issue(`Fetal movements ${text(r.movement).toLowerCase()}${of}.`);
      const bio = ([["bpd", "BPD"], ["hc", "HC"], ["ac", "AC"], ["fl", "FL"]] as const).filter(([k]) => text(r[k]));
      if (bio.length) {
        w.w("Biometry: ");
        bio.forEach(([k, label], j) => { if (j) w.w(", "); w.w(`${label} `).val(key(k), text(r[k])).w(" mm"); });
        w.w(". ");
      }
      if (text(r.efw)) w.w("Estimated fetal weight ").val(key("efw"), text(r.efw)).w(" g.");
      c.item(`fetus_${i}`, rows.length > 1 ? `Fetus ${i + 1}` : "Fetus", w);
    });
  },

  "Dating by this scan": (c) => {
    const w = c.write();
    if (c.has("ga_weeks") || c.has("ga_days")) {
      w.w("Gestational age by this scan ");
      if (c.has("ga_weeks")) w.val("ga_weeks").w(" weeks");
      if (c.has("ga_days")) w.w(c.has("ga_weeks") ? " " : "").val("ga_days").w(" days");
      w.w(".");
    }
    if (c.has("edd_scan")) w.w(" Expected date of delivery by scan ").val("edd_scan").w(".");
    c.item("dating", "Dating", w);
  },

  "Placenta and liquor": (c) => {
    const w = c.write();
    const [site, grade, previa] = [c.s("pl_site"), c.s("pl_grade"), c.s("pl_previa")];
    if (site || grade || previa || c.has("pl_os")) {
      w.w(site ? `Placenta is ${site.toLowerCase()}` : "Placenta");
      if (grade) w.w(`${site ? "," : " is"} grade ${grade}`);
      if (previa === "Clear of the os") w.w(", clear of the internal os");
      else if (previa) { w.w(`, ${previa.toLowerCase()}`); c.issue(previa === "Low lying" ? "Low lying placenta." : `${previa.replace(/ previa$/, "")} placenta previa.`); }
      if (c.has("pl_os")) w.w(" (lower edge ").val("pl_os").w(" cm from the internal os)");
      w.w(". ");
    }
    if (c.has("afi")) {
      const f = c.flag("afi");
      w.w("Amniotic fluid index ").val("afi").w(f === "Low" ? " cm (reduced liquor). " : f === "High" ? " cm (increased liquor). " : " cm (adequate liquor). ");
      if (f) c.issue(f === "Low" ? "Oligohydramnios." : "Polyhydramnios.");
    }
    if (c.has("dvp")) {
      const f = c.flag("dvp");
      w.w("Deepest vertical pocket ").val("dvp").w(f === "Low" ? " cm (reduced). " : f === "High" ? " cm (increased). " : " cm. ");
      if (f && !c.has("afi")) c.issue(f === "Low" ? "Oligohydramnios." : "Polyhydramnios.");
    }
    if (c.has("cervix")) {
      const short = c.flag("cervix") === "Low";
      w.w("Cervical length ").val("cervix").w(short ? " cm (short cervix)." : " cm.");
      if (short) c.issue("Short cervix.");
    }
    c.item("placenta", "Placenta and liquor", w);
  },

  "Fetal anatomy and mother": (c) => {
    const w = c.write();
    const an = c.s("anatomy");
    if (an === "Normal") w.w("Fetal anatomy appears normal as far as seen.");
    else if (an) {
      w.w(an === "Abnormal" ? "Fetal anatomy: abnormal" : "Fetal anatomy not fully assessed");
      if (c.has("anatomy_detail")) w.w(": ").val("anatomy_detail");
      w.w(".");
      c.issue(an === "Abnormal" ? "Fetal anomaly; see findings." : "Fetal anatomy not fully assessed.");
    }
    const ad = c.s("adnexa");
    if (ad === "Normal") w.w(" Both adnexa appear normal.");
    else if (ad) { w.w(" Adnexa: abnormal"); if (c.has("adnexa_detail")) w.w(": ").val("adnexa_detail"); w.w("."); c.issue("Abnormal adnexa."); }
    if (c.has("free_fluid")) {
      if (yesNo(c, "free_fluid")) { w.w(" Free fluid seen."); c.issue("Free fluid."); }
      else w.w(" No free fluid seen.");
    }
    c.item("anatomy", "Fetal anatomy and mother", w);
  },
};

/** The sections written out in sentences (every section of every pattern). */
export const NARRATED_SECTIONS = Object.keys(NARRATORS);

/** The heading a section's paragraphs print under. */
function groupOf(t: UsTemplate, s: UsSection): string {
  if (t.id === "abdomen") return s.title === "Urinary bladder" || s.title === "Prostate" ? "Pelvic findings" : "Abdominal findings";
  return "Sonographic findings";
}

const hasValue = (v: UsValue | undefined) => (Array.isArray(v) ? v.some((r) => Object.values(r).some((x) => String(x ?? "").trim())) : text(v) !== "");

/** Whether the doctor entered anything in this section (written out only then). */
function sectionFilled(s: UsSection, v: UsValues, gender: string | null) {
  return s.fields.some((f) => f.type !== "computed" && fieldShown(f, v, gender) && hasValue(v[f.key]));
}

/** The paragraphs the entered values make, and the findings worth a line in the conclusion. */
export function narrativeItems(t: UsTemplate, v: UsValues, ctx: UsContext): { items: NarrativeItem[]; issues: string[] } {
  const items: NarrativeItem[] = [];
  const issues: string[] = [];
  const fields = new Map(t.sections.flatMap((s) => s.fields.map((f) => [f.key, f] as const)));
  for (const s of t.sections) {
    if (!sectionShown(s, v, ctx.gender) || !sectionFilled(s, v, ctx.gender)) continue;
    const narrate = NARRATORS[s.title];
    if (!narrate) continue;
    const shown = (key: string) => { const f = fields.get(key); return !f || fieldShown(f, v, ctx.gender); };
    const c: Ctx = {
      v, ctx,
      s: (key) => (shown(key) ? text(v[key]) : ""),
      n: (key) => (shown(key) ? num(v[key]) : null),
      has: (key) => shown(key) && hasValue(v[key]),
      flag: (key) => { const f = fields.get(key); return f && shown(key) ? rangeFlag(v[key], f) : null; },
      rows: (key) => (shown(key) && Array.isArray(v[key]) ? (v[key] as UsRow[]) : []),
      write: () => new Writer(v, fields, ctx),
      issue: (x) => issues.push(x),
      item: (id, label, w) => { if (!w.empty) items.push({ id, group: groupOf(t, s), label, parts: tidy(w.parts) }); },
    };
    narrate(c);
  }
  return { items, issues: [...new Set(issues)] };
}

/** Joins neighbouring words and trims the ends. */
function tidy(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (typeof p === "string" && typeof last === "string") out[out.length - 1] = last + p;
    else out.push(p);
  }
  if (typeof out[0] === "string") out[0] = out[0].trimStart();
  const end = out.length - 1;
  if (typeof out[end] === "string") out[end] = (out[end] as string).trimEnd();
  return out.filter((p) => p !== "");
}

// ── Edits that keep the values ────────────────────────────────────────────

export interface Token { key: string; value: string }
export const tokensOf = (it: NarrativeItem): Token[] => it.parts.filter((p): p is Token => typeof p !== "string");
export const itemText = (it: NarrativeItem) => it.parts.map((p) => (typeof p === "string" ? p : p.value)).join("");

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARK = /\{\{([^{}]+)\}\}/g;

/** The doctor's wording of a paragraph, with each value it still contains kept as {{key}}. */
export function toTemplate(edited: string, tokens: Token[]): string {
  const taken: [number, number][] = [];
  const found: { at: number; end: number; key: string }[] = [];
  let from = 0;
  for (const t of tokens) {
    // A value on its own (not part of a longer number), in order where it can be, else anywhere.
    const re = new RegExp(`(?<![\\w.])${esc(t.value)}(?![\\w]|\\.\\d)`, "g");
    const free = (i: number) => !taken.some(([a, b]) => i < b && i + t.value.length > a);
    let hit: number | null = null;
    for (const start of [from, 0]) {
      re.lastIndex = start;
      for (let m = re.exec(edited); m; m = re.exec(edited)) if (free(m.index)) { hit = m.index; break; }
      if (hit != null) break;
    }
    if (hit == null) continue;
    taken.push([hit, hit + t.value.length]);
    found.push({ at: hit, end: hit + t.value.length, key: t.key });
    from = hit + t.value.length;
  }
  found.sort((a, b) => b.at - a.at);
  let out = edited.replace(/\{\{|\}\}/g, "");
  // The marker removal above can't shift positions unless the doctor typed braces; then the values are looked for again.
  if (out !== edited) return toTemplate(out, tokens);
  for (const f of found) out = `${out.slice(0, f.at)}{{${f.key}}}${out.slice(f.end)}`;
  return out;
}

/** A kept wording with today's values; the values it is missing, and markers whose value was cleared. */
export function renderTemplate(template: string, tokens: Token[]): { text: string; missing: Token[]; cleared: boolean } {
  const byKey = new Map(tokens.map((t) => [t.key, t.value]));
  let cleared = false;
  const out = template.replace(MARK, (_, key: string) => {
    const v = byKey.get(key);
    if (v == null) { cleared = true; return ""; }
    return v;
  });
  const used = new Set([...template.matchAll(MARK)].map((m) => m[1]));
  return { text: out, missing: tokens.filter((t) => !used.has(t.key)), cleared };
}

export interface NarrativeView { item: NarrativeItem; text: string; edited: boolean; error: string | null }

/** Each paragraph as it will print: the doctor's wording when edited, else the written one. */
export function narrativeView(t: UsTemplate, v: UsValues, ctx: UsContext, edits: Record<string, string> = {}): { paragraphs: NarrativeView[]; issues: string[] } {
  const { items, issues } = narrativeItems(t, v, ctx);
  const paragraphs = items.map((item): NarrativeView => {
    const tpl = edits[item.id];
    if (tpl == null) return { item, text: itemText(item), edited: false, error: null };
    const r = renderTemplate(tpl, tokensOf(item));
    const error = r.missing.length
      ? `${item.label}: keep ${r.missing.map((m) => m.value).join(", ")} in the text (values are changed in the form above), or reset the paragraph.`
      : r.cleared ? `${item.label}: a value in this text was cleared in the form. Reset the paragraph or type the text again.` : null;
    return { item, text: r.text, edited: true, error };
  });
  return { paragraphs, issues };
}

/** The conclusion the findings suggest, one line each. */
export function suggestedConclusion(t: UsTemplate, v: UsValues, ctx: UsContext): string {
  const { issues } = narrativeItems(t, v, ctx);
  if (t.id === "obstetric") {
    const lines: string[] = [];
    const n = text(v.fetus_number);
    const fetuses = Array.isArray(v.fetuses) ? (v.fetuses as UsRow[]) : [];
    const alive = text(v.early_cardiac) === "Present" || (fetuses.length > 0 && fetuses.every((r) => text(r.cardiac) === "Present"));
    const kind = { Single: "Single", Twins: "Twin", Triplets: "Triplet", "More than three": "Multiple" }[n] ?? "";
    const ga = text(v.ga_weeks) ? ` of ${text(v.ga_weeks)} weeks${text(v.ga_days) ? ` ${text(v.ga_days)} days` : ""} by scan` : "";
    if (kind || alive || ga) lines.push(`${kind || "A"}${alive ? " live" : ""} intrauterine pregnancy${ga}.`.replace(/^A live/, "Live").replace(/^A intra/, "Intra"));
    return [...lines, ...issues].join("\n");
  }
  if (issues.length) return issues.join("\n");
  const scope: Record<string, string> = {
    kub: "kidneys, ureters and urinary bladder", abdomen: "visualized abdominal and pelvic organs", pelvis: "visualized pelvic organs",
  };
  return `Normal sonographic appearance of the ${scope[t.id] ?? "visualized organs"}. No acute abnormality identified.`;
}

/** The findings written out as plain text (for screens that show a report as text). */
export const narrativeText = (paragraphs: NarrativeParagraph[]) => {
  const out: string[] = [];
  let group = "";
  for (const p of paragraphs) {
    if (p.group !== group) { if (out.length) out.push(""); out.push(p.group.toUpperCase()); group = p.group; }
    out.push(`${p.label}: ${p.text}`);
  }
  return out.join("\n");
};

/** Signing an ultrasound report: checks the values and the doctor's wording,
 * and returns what is saved. The same on MAVIN.pk and offline. */
export function finalizeUltrasound(s: StructuredReport, ctx: UsContext, validate: (t: UsTemplate, v: UsValues, ctx: UsContext) => string[], clean: (v: unknown) => string | null):
  { structured: StructuredReport; findings: string } {
  const template = ultrasoundTemplate(s.template);
  if (!template) throw new Error("Choose the report pattern.");
  const errors = validate(template, s.values, ctx);
  const edits = cleanEdits(s.edits);
  const view = narrativeView(template, s.values, ctx, edits);
  errors.push(...view.paragraphs.map((p) => p.error).filter((e): e is string => Boolean(e)));
  if (errors.length) throw new Error(errors.join(" "));
  const paragraphs: NarrativeParagraph[] = view.paragraphs
    .map((p) => ({ id: p.item.id, group: p.item.group, label: p.item.label, text: p.text.trim() }))
    .filter((p) => p.text);
  const kept = Object.fromEntries(Object.entries(edits).filter(([id]) => paragraphs.some((p) => p.id === id)));
  return {
    structured: {
      template: template.id, values: s.values, recommendation: clean(s.recommendation), note: clean(s.note),
      ...(Object.keys(kept).length ? { edits: kept } : {}), narrative: paragraphs,
    },
    findings: narrativeText(paragraphs),
  };
}

function cleanEdits(e: unknown): Record<string, string> {
  if (!e || typeof e !== "object" || Array.isArray(e)) return {};
  return Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([k, x]) => /^[\w-]{1,40}$/.test(k) && typeof x === "string").map(([k, x]) => [k, (x as string).slice(0, 4000)]));
}
