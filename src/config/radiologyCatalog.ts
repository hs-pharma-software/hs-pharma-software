/** The standard list of radiology studies a hospital can load into Performing
 * Images. Fees are not included: each hospital enters its own, and a study is
 * performed (orderable) once it has a fee. */

export const MODALITIES = ["X-Ray", "Ultrasound", "Doppler", "CT Scan", "MRI", "Mammography", "Fluoroscopy", "Echocardiography", "ECG", "DEXA"];

export interface CatalogStudy {
  name: string;
  modality: string;
  /** Usual reporting time in hours. */
  tat: number;
}

const S = (modality: string, tat: number, ...names: string[]): CatalogStudy[] => names.map((name) => ({ name, modality, tat }));

export const STANDARD_IMAGING_STUDIES: CatalogStudy[] = [
  ...S("X-Ray", 2,
    "X-Ray Chest PA", "X-Ray Chest AP / Lateral", "X-Ray Abdomen Erect", "X-Ray KUB", "X-Ray Pelvis AP", "X-Ray Skull AP / Lateral", "X-Ray PNS (Waters view)",
    "X-Ray Cervical Spine AP / Lateral", "X-Ray Lumbosacral Spine AP / Lateral", "X-Ray Dorsal Spine AP / Lateral", "X-Ray Shoulder", "X-Ray Elbow", "X-Ray Wrist",
    "X-Ray Hand", "X-Ray Hip", "X-Ray Knee AP / Lateral", "X-Ray Ankle", "X-Ray Foot", "X-Ray Femur", "X-Ray Leg (Tibia / Fibula)", "X-Ray Forearm", "X-Ray Humerus"),
  ...S("Ultrasound", 2,
    "Ultrasound Abdomen", "Ultrasound Pelvis", "Ultrasound KUB", "Ultrasound Obstetric (Pregnancy)", "Ultrasound Anomaly Scan", "Ultrasound Thyroid / Neck",
    "Ultrasound Breast", "Ultrasound Scrotum / Testes", "Ultrasound Soft Tissue / Swelling", "Ultrasound Transvaginal (TVS)", "Ultrasound Prostate"),
  ...S("Doppler", 4, "Doppler Obstetric", "Doppler Lower Limb Venous", "Doppler Lower Limb Arterial", "Doppler Carotid", "Doppler Renal"),
  ...S("CT Scan", 24,
    "CT Brain (Plain)", "CT Brain (Contrast)", "CT Chest (HRCT)", "CT Abdomen & Pelvis (Contrast)", "CT KUB (Plain)", "CT Cervical Spine", "CT Lumbar Spine",
    "CT PNS", "CT Angiography"),
  ...S("MRI", 48, "MRI Brain", "MRI Cervical Spine", "MRI Lumbosacral Spine", "MRI Knee", "MRI Shoulder", "MRI Abdomen", "MRCP"),
  ...S("Mammography", 24, "Mammography (Bilateral)"),
  ...S("Fluoroscopy", 24, "Barium Swallow", "Barium Meal", "IVU (Intravenous Urogram)", "HSG (Hysterosalpingography)"),
  ...S("Echocardiography", 4, "Echocardiography (2D Echo)"),
  ...S("ECG", 1, "ECG (12-lead)"),
  ...S("DEXA", 24, "DEXA Scan (Bone Density)"),
];
