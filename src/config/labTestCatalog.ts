/** The standard list of major laboratory tests a hospital lab can load into
 * Performing Tests. Reference ranges are typical adult values (conventional
 * units); every lab must check them against its own analyser / kit inserts and
 * edit them. Fees are not included: each lab enters its own. */

export interface CatalogTest {
  name: string;
  section: string;
  sample: string;
  unit: string | null;
  range: string | null;
  /** Usual turnaround in hours. */
  tat: number;
}

export const SAMPLE_TYPES = [
  "Whole blood (EDTA)",
  "Whole blood (Citrate)",
  "Serum",
  "Plasma (Fluoride)",
  "Plasma (Citrate)",
  "Plasma (EDTA)",
  "Arterial blood (Heparin)",
  "Blood (culture bottle)",
  "Urine",
  "Urine (sterile, midstream)",
  "Urine (24-hour)",
  "Stool",
  "Sputum",
  "Swab",
  "Pus",
  "CSF",
  "Semen",
  "Body fluid",
  "Tissue",
];

const T = (name: string, section: string, sample: string, unit: string | null, range: string | null, tat: number): CatalogTest => ({ name, section, sample, unit, range, tat });

const HEM = "Haematology";
const COAG = "Coagulation";
const DIAB = "Diabetes";
const RENAL = "Renal & Electrolytes";
const LIVER = "Liver";
const LIPID = "Lipids";
const CARD = "Cardiac";
const THY = "Thyroid & Hormones";
const VIT = "Vitamins, Iron & Minerals";
const PANC = "Pancreas";
const INFL = "Inflammation & Immunology";
const SERO = "Serology & Infectious";
const URINE = "Urine";
const STOOL = "Stool";
const MICRO = "Microbiology";
const TUMOR = "Tumour Markers";
const OTHER = "Other";

export const STANDARD_LAB_TESTS: CatalogTest[] = [
  // Haematology
  T("Complete Blood Count (CBC)", HEM, "Whole blood (EDTA)", null, "Hb, TLC, DLC, platelets, RBC indices (see report)", 2),
  T("Haemoglobin (Hb)", HEM, "Whole blood (EDTA)", "g/dL", "M 13.0-17.0; F 12.0-15.0", 2),
  T("Total Leucocyte Count (TLC)", HEM, "Whole blood (EDTA)", "x10^3/uL", "4.0-11.0", 2),
  T("Differential Leucocyte Count (DLC)", HEM, "Whole blood (EDTA)", "%", "Neutrophils 40-75; Lymphocytes 20-45; Monocytes 2-10; Eosinophils 1-6; Basophils 0-1", 2),
  T("Platelet Count", HEM, "Whole blood (EDTA)", "x10^3/uL", "150-400", 2),
  T("Red Cell Count (RBC)", HEM, "Whole blood (EDTA)", "x10^6/uL", "M 4.5-5.5; F 3.8-4.8", 2),
  T("Haematocrit (HCT / PCV)", HEM, "Whole blood (EDTA)", "%", "M 40-50; F 36-46", 2),
  T("MCV", HEM, "Whole blood (EDTA)", "fL", "80-100", 2),
  T("MCH", HEM, "Whole blood (EDTA)", "pg", "27-32", 2),
  T("MCHC", HEM, "Whole blood (EDTA)", "g/dL", "32-36", 2),
  T("ESR (Westergren)", HEM, "Whole blood (Citrate)", "mm/1st hour", "M 0-15; F 0-20", 2),
  T("Reticulocyte Count", HEM, "Whole blood (EDTA)", "%", "0.5-2.5", 4),
  T("Peripheral Blood Smear (Film)", HEM, "Whole blood (EDTA)", null, "Normocytic normochromic; no abnormal cells", 6),
  T("Malaria Parasite (Smear)", HEM, "Whole blood (EDTA)", null, "Not seen", 2),
  T("Malaria Antigen (ICT)", HEM, "Whole blood (EDTA)", null, "Negative", 1),
  T("Blood Group & Rh Factor", HEM, "Whole blood (EDTA)", null, null, 1),
  T("Bleeding Time (BT)", HEM, "Whole blood (EDTA)", "minutes", "2-7", 1),
  T("Clotting Time (CT)", HEM, "Whole blood (EDTA)", "minutes", "5-10", 1),

  // Coagulation
  T("Prothrombin Time (PT)", COAG, "Plasma (Citrate)", "seconds", "11.0-13.5", 2),
  T("INR", COAG, "Plasma (Citrate)", null, "0.8-1.2 (therapeutic on warfarin 2.0-3.0)", 2),
  T("APTT", COAG, "Plasma (Citrate)", "seconds", "25-35", 2),
  T("Fibrinogen", COAG, "Plasma (Citrate)", "mg/dL", "200-400", 4),
  T("D-Dimer", COAG, "Plasma (Citrate)", "ug/mL FEU", "< 0.5", 2),

  // Diabetes
  T("Blood Sugar Fasting (FBS)", DIAB, "Plasma (Fluoride)", "mg/dL", "70-99 (diabetes >= 126)", 1),
  T("Blood Sugar Random (RBS)", DIAB, "Plasma (Fluoride)", "mg/dL", "70-140 (diabetes >= 200)", 1),
  T("Blood Sugar 2 Hours After Meal (PP)", DIAB, "Plasma (Fluoride)", "mg/dL", "< 140", 1),
  T("HbA1c", DIAB, "Whole blood (EDTA)", "%", "< 5.7 normal; 5.7-6.4 prediabetes; >= 6.5 diabetes", 4),
  T("Oral Glucose Tolerance Test (OGTT, 75 g)", DIAB, "Plasma (Fluoride)", "mg/dL", "Fasting < 100; 2 hours < 140", 3),

  // Renal & electrolytes
  T("Renal Function Tests (RFT)", RENAL, "Serum", null, "Urea, creatinine, electrolytes (see report)", 3),
  T("Urea", RENAL, "Serum", "mg/dL", "15-45", 2),
  T("Blood Urea Nitrogen (BUN)", RENAL, "Serum", "mg/dL", "7-20", 2),
  T("Creatinine", RENAL, "Serum", "mg/dL", "M 0.7-1.3; F 0.6-1.1", 2),
  T("Uric Acid", RENAL, "Serum", "mg/dL", "M 3.5-7.2; F 2.6-6.0", 2),
  T("Serum Electrolytes (Na, K, Cl)", RENAL, "Serum", "mmol/L", "Na 135-145; K 3.5-5.1; Cl 98-107", 2),
  T("Sodium (Na)", RENAL, "Serum", "mmol/L", "135-145", 2),
  T("Potassium (K)", RENAL, "Serum", "mmol/L", "3.5-5.1", 2),
  T("Chloride (Cl)", RENAL, "Serum", "mmol/L", "98-107", 2),
  T("Bicarbonate (HCO3)", RENAL, "Serum", "mmol/L", "22-29", 2),
  T("Calcium (Total)", RENAL, "Serum", "mg/dL", "8.5-10.5", 2),
  T("Phosphorus", RENAL, "Serum", "mg/dL", "2.5-4.5", 2),
  T("Magnesium", RENAL, "Serum", "mg/dL", "1.7-2.4", 2),

  // Liver
  T("Liver Function Tests (LFT)", LIVER, "Serum", null, "Bilirubin, ALT, AST, ALP, proteins (see report)", 3),
  T("Bilirubin Total", LIVER, "Serum", "mg/dL", "0.3-1.2", 2),
  T("Bilirubin Direct", LIVER, "Serum", "mg/dL", "0.0-0.3", 2),
  T("ALT (SGPT)", LIVER, "Serum", "U/L", "Up to 40", 2),
  T("AST (SGOT)", LIVER, "Serum", "U/L", "Up to 40", 2),
  T("Alkaline Phosphatase (ALP)", LIVER, "Serum", "U/L", "44-147 (adults)", 2),
  T("Gamma GT (GGT)", LIVER, "Serum", "U/L", "M < 55; F < 38", 2),
  T("Total Protein", LIVER, "Serum", "g/dL", "6.0-8.3", 2),
  T("Albumin", LIVER, "Serum", "g/dL", "3.5-5.2", 2),
  T("Globulin", LIVER, "Serum", "g/dL", "2.0-3.5", 2),
  T("A/G Ratio", LIVER, "Serum", null, "1.1-2.5", 2),

  // Lipids
  T("Lipid Profile", LIPID, "Serum", "mg/dL", "Fasting 9-12 hours; cholesterol, TG, HDL, LDL (see report)", 3),
  T("Cholesterol Total", LIPID, "Serum", "mg/dL", "< 200 desirable", 2),
  T("Triglycerides", LIPID, "Serum", "mg/dL", "< 150", 2),
  T("HDL Cholesterol", LIPID, "Serum", "mg/dL", "M > 40; F > 50", 2),
  T("LDL Cholesterol", LIPID, "Serum", "mg/dL", "< 100 optimal", 2),
  T("VLDL Cholesterol", LIPID, "Serum", "mg/dL", "5-40", 2),

  // Cardiac
  T("Troponin I", CARD, "Serum", "ng/mL", "< 0.04 (assay-specific cut-off)", 1),
  T("CK-MB", CARD, "Serum", "U/L", "< 25", 2),
  T("CPK (CK Total)", CARD, "Serum", "U/L", "M 39-308; F 26-192", 2),
  T("LDH", CARD, "Serum", "U/L", "140-280", 2),
  T("NT-proBNP", CARD, "Serum", "pg/mL", "< 125 (under 75 years)", 4),

  // Thyroid & hormones
  T("Thyroid Function Tests (TFT)", THY, "Serum", null, "TSH, FT4, FT3 (see report)", 24),
  T("TSH", THY, "Serum", "uIU/mL", "0.4-4.0", 24),
  T("Free T4 (FT4)", THY, "Serum", "ng/dL", "0.8-1.8", 24),
  T("Free T3 (FT3)", THY, "Serum", "pg/mL", "2.3-4.2", 24),
  T("Total T3", THY, "Serum", "ng/dL", "80-200", 24),
  T("Total T4", THY, "Serum", "ug/dL", "5.0-12.0", 24),
  T("Prolactin", THY, "Serum", "ng/mL", "M 2-18; F 2-29 (non-pregnant)", 24),
  T("FSH", THY, "Serum", "mIU/mL", "Varies with sex and cycle phase (see report)", 24),
  T("LH", THY, "Serum", "mIU/mL", "Varies with sex and cycle phase (see report)", 24),
  T("Testosterone (Total)", THY, "Serum", "ng/dL", "M 300-1000; F 15-70", 24),
  T("Estradiol (E2)", THY, "Serum", "pg/mL", "Varies with cycle phase (see report)", 24),
  T("Beta hCG (Quantitative)", THY, "Serum", "mIU/mL", "< 5 (not pregnant)", 4),
  T("Urine Pregnancy Test", THY, "Urine", null, "Negative", 1),
  T("Cortisol (Morning)", THY, "Serum", "ug/dL", "6-23", 24),

  // Vitamins, iron & minerals
  T("Vitamin D (25-OH)", VIT, "Serum", "ng/mL", "30-100 sufficient; 20-29 insufficient; < 20 deficient", 24),
  T("Vitamin B12", VIT, "Serum", "pg/mL", "200-900", 24),
  T("Folate (Folic Acid)", VIT, "Serum", "ng/mL", "2.7-17", 24),
  T("Serum Iron", VIT, "Serum", "ug/dL", "M 65-175; F 50-170", 4),
  T("TIBC", VIT, "Serum", "ug/dL", "250-450", 4),
  T("Ferritin", VIT, "Serum", "ng/mL", "M 30-400; F 15-150", 24),
  T("Transferrin Saturation", VIT, "Serum", "%", "20-50", 4),

  // Pancreas
  T("Amylase", PANC, "Serum", "U/L", "30-110", 2),
  T("Lipase", PANC, "Serum", "U/L", "13-60", 2),

  // Inflammation & immunology
  T("C-Reactive Protein (CRP)", INFL, "Serum", "mg/L", "< 5", 2),
  T("hs-CRP", INFL, "Serum", "mg/L", "< 1 low risk; 1-3 average; > 3 high risk", 4),
  T("Procalcitonin", INFL, "Serum", "ng/mL", "< 0.05", 4),
  T("Rheumatoid Factor (RA)", INFL, "Serum", "IU/mL", "< 14", 4),
  T("ASO Titre", INFL, "Serum", "IU/mL", "< 200", 4),
  T("ANA", INFL, "Serum", null, "Negative", 48),
  T("Anti-CCP", INFL, "Serum", "U/mL", "< 20", 48),

  // Serology & infectious
  T("HBsAg (Hepatitis B)", SERO, "Serum", null, "Non-reactive", 2),
  T("Anti-HCV (Hepatitis C)", SERO, "Serum", null, "Non-reactive", 2),
  T("HIV 1 & 2 Antibodies", SERO, "Serum", null, "Non-reactive", 2),
  T("Syphilis (VDRL / TPHA)", SERO, "Serum", null, "Non-reactive", 4),
  T("Typhoid IgM / IgG (Typhidot)", SERO, "Serum", null, "Negative", 2),
  T("Widal Test", SERO, "Serum", "titre", "< 1:80", 4),
  T("Dengue NS1 Antigen", SERO, "Serum", null, "Negative", 2),
  T("Dengue IgM / IgG", SERO, "Serum", null, "Negative", 2),
  T("H. pylori Antibody", SERO, "Serum", null, "Negative", 2),
  T("H. pylori Stool Antigen", SERO, "Stool", null, "Negative", 4),
  T("Brucella Antibodies", SERO, "Serum", "titre", "< 1:80", 24),
  T("Toxoplasma IgM", SERO, "Serum", null, "Negative", 24),
  T("COVID-19 PCR", SERO, "Swab", null, "Not detected", 24),

  // Urine
  T("Urine Routine Examination (Urine R/E)", URINE, "Urine", null, "Physical, chemical and microscopic (see report)", 2),
  T("Urine Culture & Sensitivity", URINE, "Urine (sterile, midstream)", "CFU/mL", "No significant growth", 72),
  T("Urine Microalbumin", URINE, "Urine", "mg/L", "< 30", 4),
  T("24-Hour Urine Protein", URINE, "Urine (24-hour)", "mg/24 h", "< 150", 24),

  // Stool
  T("Stool Routine Examination (Stool R/E)", STOOL, "Stool", null, "No ova, cysts or parasites seen", 2),
  T("Stool Occult Blood", STOOL, "Stool", null, "Negative", 2),
  T("Stool Culture & Sensitivity", STOOL, "Stool", null, "No pathogens isolated", 72),

  // Microbiology
  T("Blood Culture & Sensitivity", MICRO, "Blood (culture bottle)", null, "No growth after 5 days", 120),
  T("Sputum AFB Smear (ZN Stain)", MICRO, "Sputum", null, "No AFB seen", 24),
  T("GeneXpert MTB / RIF", MICRO, "Sputum", null, "MTB not detected", 24),
  T("Sputum Culture & Sensitivity", MICRO, "Sputum", null, "Normal flora", 72),
  T("Pus Culture & Sensitivity", MICRO, "Pus", null, "No growth", 72),
  T("Throat Swab Culture & Sensitivity", MICRO, "Swab", null, "Normal flora", 72),
  T("High Vaginal Swab Culture & Sensitivity", MICRO, "Swab", null, "No pathogens isolated", 72),
  T("Gram Stain", MICRO, "Body fluid", null, "No organisms seen", 2),

  // Tumour markers
  T("PSA (Total)", TUMOR, "Serum", "ng/mL", "< 4.0", 24),
  T("CEA", TUMOR, "Serum", "ng/mL", "< 5.0", 24),
  T("CA-125", TUMOR, "Serum", "U/mL", "< 35", 24),
  T("CA 19-9", TUMOR, "Serum", "U/mL", "< 37", 24),
  T("CA 15-3", TUMOR, "Serum", "U/mL", "< 30", 24),
  T("Alpha-Fetoprotein (AFP)", TUMOR, "Serum", "ng/mL", "< 10", 24),

  // Other
  T("Arterial Blood Gases (ABGs)", OTHER, "Arterial blood (Heparin)", null, "pH 7.35-7.45; pCO2 35-45 mmHg; pO2 80-100 mmHg; HCO3 22-26 mmol/L", 1),
  T("Serum Lactate", OTHER, "Plasma (Fluoride)", "mmol/L", "0.5-2.2", 1),
  T("Serum Ammonia", OTHER, "Plasma (EDTA)", "umol/L", "15-45", 2),
  T("Serum Osmolality", OTHER, "Serum", "mOsm/kg", "275-295", 4),
  T("CSF Routine Examination", OTHER, "CSF", null, "Clear; cells 0-5/uL; protein 15-45 mg/dL; glucose 40-70 mg/dL", 2),
  T("Semen Analysis", OTHER, "Semen", null, "WHO 2021 lower limits: volume 1.4 mL; count 16 million/mL; progressive motility 30%", 4),
];

export const LAB_SECTIONS = [...new Set(STANDARD_LAB_TESTS.map((t) => t.section))];
