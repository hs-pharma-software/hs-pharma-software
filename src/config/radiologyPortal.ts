/** Radiology portal: the standard modalities (with their DICOM modality
 * codes), examination protocols, the technologist's safety and preparation
 * checks, and what must be done before an examination is completed. */

export interface StandardModality {
  code: string;
  name: string;
  /** DICOM Modality (0008,0060) sent to the machine in its worklist. */
  dicom: string;
  /** The modality names used in Performing Images (config/radiologyCatalog). */
  aliases: string[];
}

export const STANDARD_MODALITIES: StandardModality[] = [
  { code: "XRAY", name: "X-Ray", dicom: "DX", aliases: ["x-ray", "xray", "xr", "radiography", "cr", "dx"] },
  { code: "US", name: "Ultrasound", dicom: "US", aliases: ["ultrasound", "ultra-sound", "usg", "us", "sonography"] },
  { code: "DOPPLER", name: "Doppler", dicom: "US", aliases: ["doppler"] },
  { code: "CT", name: "CT Scan", dicom: "CT", aliases: ["ct scan", "ct-scan", "ct", "computed tomography"] },
  { code: "MRI", name: "MRI", dicom: "MR", aliases: ["mri", "mr", "magnetic resonance"] },
  { code: "MAMMO", name: "Mammography", dicom: "MG", aliases: ["mammography", "mammo", "mg"] },
  { code: "FLUORO", name: "Fluoroscopy", dicom: "RF", aliases: ["fluoroscopy", "fluoro", "rf"] },
  { code: "ECHO", name: "Echocardiography", dicom: "US", aliases: ["echocardiography", "echo"] },
  { code: "ECG", name: "ECG", dicom: "ECG", aliases: ["ecg", "ekg"] },
  { code: "DEXA", name: "DEXA", dicom: "BMD", aliases: ["dexa", "bmd", "bone densitometry"] },
];

export const DICOM_MODALITY_CODES = ["DX", "CR", "US", "CT", "MR", "MG", "RF", "XA", "NM", "PT", "ECG", "BMD", "OT"];

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The standard modality a study's modality text belongs to ("X-Ray" -> XRAY). */
export function standardModalityFor(text: string | null | undefined): StandardModality | null {
  const t = norm(text);
  if (!t) return null;
  return STANDARD_MODALITIES.find((m) => m.code.toLowerCase() === t || norm(m.name) === t || m.aliases.includes(t)) ?? null;
}

/** Protocols the technologist can pick, by modality code. */
export const PROTOCOLS: Record<string, string[]> = {
  XRAY: ["Single view (PA / AP)", "Two views (AP + Lateral)", "Three views (AP + Lateral + Oblique)", "Weight-bearing views", "Portable / bedside", "Comparison view (opposite side)"],
  US: ["Standard survey", "Focused / targeted", "Full bladder (pelvic)", "Transvaginal", "Obstetric growth scan", "Anomaly scan"],
  DOPPLER: ["Venous", "Arterial", "Obstetric Doppler", "Carotid", "Renal"],
  CT: ["Plain (non-contrast)", "IV contrast, single phase", "Triple phase", "HRCT", "CT angiography", "Low-dose"],
  MRI: ["Plain", "With gadolinium contrast", "MR angiography", "MRCP", "Diffusion-weighted"],
  MAMMO: ["Screening (CC + MLO both sides)", "Diagnostic with spot / magnification views"],
  FLUORO: ["Barium swallow", "Barium meal", "IVU", "HSG", "Micturating cystourethrogram"],
  ECHO: ["Transthoracic (TTE)", "Limited / focused"],
  ECG: ["12-lead resting"],
  DEXA: ["Lumbar spine + hip", "Forearm"],
};

/** Allergy and contraindication checks: ticked only when present. */
export const SAFETY_CHECKS = [
  { key: "contrast_allergy", label: "Contrast allergy" },
  { key: "pacemaker", label: "Pacemaker" },
  { key: "metal_implants", label: "Metal implants" },
  { key: "pregnancy", label: "Pregnancy" },
  { key: "kidney_disease", label: "Kidney disease" },
  { key: "claustrophobia", label: "Claustrophobia" },
] as const;

/** Patient preparation the technologist confirms. Consent and identity are required. */
export const PREP_CHECKS = [
  { key: "fasting", label: "Fasting complete", required: false },
  { key: "metal_removed", label: "Metal removed", required: false },
  { key: "bladder", label: "Bladder empty / full as instructed", required: false },
  { key: "gown", label: "Gown changed", required: false },
  { key: "consent", label: "Consent signed", required: true },
  { key: "identity", label: "Identity verified (name + MR number)", required: true },
] as const;

export const PATIENT_POSITIONS = ["Supine", "Prone", "Erect / standing", "Sitting", "Lateral decubitus", "Oblique", "Lithotomy"];
export const IMAGE_QUALITY = ["Good", "Adequate", "Suboptimal", "Repeat needed"];

export interface ExamData {
  clinical: { history: string; indication: string; lmp: string; previousImaging: string };
  safety: { checks: Record<string, boolean>; prep: Record<string, boolean>; otherNotes: string };
  protocol: {
    name: string; kvp: string; mas: string; sliceThickness: string; fov: string;
    contrast: boolean; contrastAgent: string; contrastVolume: string; dose: string;
  };
  acquisition: {
    position: string; quality: string; series: string; imagesPerSeries: string; breathHold: string;
    markers: string; techNotes: string; qualityComments: string;
  };
}

export function emptyExam(clinicalHistory?: string | null): ExamData {
  return {
    clinical: { history: clinicalHistory ?? "", indication: "", lmp: "", previousImaging: "" },
    safety: { checks: {}, prep: {}, otherNotes: "" },
    protocol: { name: "", kvp: "", mas: "", sliceThickness: "", fov: "", contrast: false, contrastAgent: "", contrastVolume: "", dose: "" },
    acquisition: { position: "", quality: "", series: "1", imagesPerSeries: "1", breathHold: "", markers: "", techNotes: "", qualityComments: "" },
  };
}

/** A saved examination record, with any section a newer version added filled in. */
export function parseExam(json: string | null | undefined, clinicalHistory?: string | null): ExamData {
  const base = emptyExam(clinicalHistory);
  if (!json) return base;
  try {
    const d = JSON.parse(json) as Partial<ExamData>;
    return {
      clinical: { ...base.clinical, ...d.clinical },
      safety: { ...base.safety, ...d.safety, checks: { ...d.safety?.checks }, prep: { ...d.safety?.prep } },
      protocol: { ...base.protocol, ...d.protocol },
      acquisition: { ...base.acquisition, ...d.acquisition },
    };
  } catch {
    return base;
  }
}

/** What stops an examination from being completed (errors) and what the
 * technologist must confirm first (warnings). Nothing is ticked for them. */
export function validateExam(d: ExamData, patient?: { gender?: string | null; ageYears?: number | null }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const p of PREP_CHECKS) if (p.required && !d.safety.prep[p.key]) errors.push(`${p.label} is not ticked.`);
  if (!d.protocol.name) warnings.push("No examination protocol selected.");
  if (d.safety.checks.pregnancy) warnings.push("Pregnancy is marked. Make sure the radiologist approved this examination.");
  if (d.protocol.contrast && (d.safety.checks.contrast_allergy || d.safety.checks.kidney_disease)) {
    warnings.push("Contrast was given to a patient with a contrast allergy or kidney disease.");
  }
  if (d.protocol.contrast && !d.protocol.contrastAgent.trim()) warnings.push("Contrast was given but the agent is not recorded.");
  const age = patient?.ageYears;
  const childBearing = age == null || (age >= 10 && age <= 55);
  if (patient?.gender === "Female" && childBearing && !d.safety.checks.pregnancy && !d.clinical.lmp.trim()) warnings.push("Pregnancy status / LMP is not recorded for a female patient.");
  if (d.acquisition.quality === "Repeat needed") warnings.push("Image quality is marked 'Repeat needed'.");
  return { errors, warnings };
}
