/**
 * Pakistan FBR / Sales Tax Act 1990 reference data.
 * Used for searchable autocomplete in product FBR fields.
 */

// ── HS Codes ─────────────────────────────────────────────────────────────────
export interface HsCodeEntry {
  code: string;
  description: string;
}

export const FBR_HS_CODES: HsCodeEntry[] = [
  // Chapter 30 — Pharmaceutical Products
  { code: "3004.1000", description: "Medicaments containing penicillins or derivatives" },
  { code: "3004.2000", description: "Medicaments containing other antibiotics" },
  { code: "3004.3100", description: "Medicaments containing insulin" },
  { code: "3004.3200", description: "Medicaments containing corticosteroids / adrenal hormones" },
  { code: "3004.3900", description: "Medicaments containing other hormones" },
  { code: "3004.4100", description: "Medicaments containing ephedrine or its salts" },
  { code: "3004.4200", description: "Medicaments containing pseudo-ephedrine or its salts" },
  { code: "3004.4300", description: "Medicaments containing norephedrine or its salts" },
  { code: "3004.4900", description: "Medicaments containing other alkaloids / derivatives" },
  { code: "3004.5000", description: "Medicaments containing vitamins or other nutritional products" },
  { code: "3004.6000", description: "Medicaments containing artemisinin for antimalarial use" },
  { code: "3004.9010", description: "Unregistered pharmaceutical preparations" },
  { code: "3004.9020", description: "Homeopathic preparations" },
  { code: "3004.9030", description: "Veterinary medicines" },
  { code: "3004.9090", description: "Other pharmaceutical preparations (registered)" },
  // Chapter 30 — Bandages, Sutures, Dressings
  { code: "3005.1000", description: "Adhesive dressings and other articles having an adhesive layer" },
  { code: "3005.9010", description: "Absorbent gauze, cotton wool, bandages — plain" },
  { code: "3005.9090", description: "Other surgical sutures, catgut, sterile dressings" },
  // Chapter 38 — Diagnostic Reagents
  { code: "3822.1100", description: "Pregnancy test kits / ovulation prediction kits" },
  { code: "3822.1200", description: "Diabetes diagnostic reagents" },
  { code: "3822.1900", description: "Other diagnostic reagents (HCV, Malaria, Typhoid, etc.)" },
  { code: "3822.9000", description: "Reference standards for laboratory use" },
  // Chapter 90 — Medical / Surgical Instruments
  { code: "9018.3100", description: "Syringes, with or without their needles" },
  { code: "9018.3200", description: "Tubular metal needles and needles for sutures" },
  { code: "9018.3910", description: "Catheters (intravenous, urinary, cardiac)" },
  { code: "9018.3920", description: "Cannulas and similar instruments" },
  { code: "9018.3990", description: "Other catheters, needles, cannulas" },
  { code: "9018.9010", description: "Stethoscopes and blood pressure apparatus" },
  { code: "9018.9020", description: "Infusion sets (IV giving sets)" },
  { code: "9018.9090", description: "Other medical / surgical / dental instruments" },
  { code: "9019.1000", description: "Mechano-therapy appliances; massage apparatus" },
  { code: "9021.1000", description: "Orthopaedic appliances, splints, braces, slings" },
  { code: "9021.2100", description: "Artificial teeth" },
  { code: "9021.3900", description: "Other artificial parts of the body" },
  { code: "9021.4000", description: "Hearing aids" },
  { code: "9021.9000", description: "Other orthopaedic or prosthetic articles" },
  // Nutrition / Infant
  { code: "1901.1000", description: "Preparations for infant use, put up for retail sale" },
  { code: "2106.9090", description: "Other food preparations (nutraceuticals, ORS)" },
  // Personal Protective / Gloves
  { code: "4015.1100", description: "Surgical gloves (rubber)" },
  { code: "6116.1000", description: "Knitted / crocheted examination gloves" },
];

// ── FBR Sale Types ────────────────────────────────────────────────────────────
export interface SaleTypeEntry {
  value: string;
  defaultRate: number;
  description: string;
}

export const FBR_SALE_TYPES: SaleTypeEntry[] = [
  {
    value: "Goods at standard rate (default)",
    defaultRate: 17,
    description: "Standard 17% sales tax — default for taxable goods",
  },
  {
    value: "Goods at reduced rate",
    defaultRate: 8,
    description: "Reduced rate (typically 8%) — Eighth Schedule items",
  },
  {
    value: "Goods at zero rate",
    defaultRate: 0,
    description: "Zero-rated — Fifth Schedule items (exportable / specified goods)",
  },
  {
    value: "Goods exempt",
    defaultRate: 0,
    description: "Exempt from sales tax — Sixth Schedule (registered medicines, etc.)",
  },
  {
    value: "Goods at further tax rate",
    defaultRate: 3,
    description: "Further tax (3%) on supplies to unregistered buyers",
  },
  {
    value: "Services at standard rate",
    defaultRate: 17,
    description: "Services taxable at standard rate under provincial laws",
  },
];

// ── FBR UOM ───────────────────────────────────────────────────────────────────
export interface UomEntry {
  value: string;
  description: string;
}

export const FBR_UOM_LIST: UomEntry[] = [
  { value: "Numbers, pieces, units", description: "Tablets, capsules, individual units" },
  { value: "Kilograms", description: "Weight — kilograms" },
  { value: "Grams", description: "Weight — grams" },
  { value: "Milligrams", description: "Weight — milligrams" },
  { value: "Metric Tons", description: "Weight — metric tons" },
  { value: "Litres", description: "Volume — litres" },
  { value: "Millilitres", description: "Volume — millilitres (syrups, drops)" },
  { value: "Cubic Metres", description: "Volume — cubic metres" },
  { value: "Gallons", description: "Volume — gallons" },
  { value: "Metres", description: "Length — metres (sutures, bandages)" },
  { value: "Centimetres", description: "Length — centimetres" },
  { value: "Square Metres", description: "Area — square metres" },
  { value: "Pairs", description: "Pairs (gloves, stockings)" },
  { value: "Dozens", description: "Dozens (12 units)" },
  { value: "Sets", description: "Sets / kits" },
  { value: "Packs", description: "Sealed packs / blister packs" },
  { value: "Boxes", description: "Boxes" },
  { value: "Bottles", description: "Bottles (syrups, drops)" },
  { value: "Ampoules", description: "Ampoules (injections)" },
  { value: "Vials", description: "Vials (injections, vaccines)" },
  { value: "Sachets", description: "Sachets / single-dose pouches" },
  { value: "Strips", description: "Blister strips (tablets / capsules per strip)" },
  { value: "Rolls", description: "Rolls (bandages, tapes)" },
  { value: "Sheets", description: "Sheets (wound dressings)" },
];

// ── SRO Schedules ─────────────────────────────────────────────────────────────
export interface SroScheduleEntry {
  value: string;
  description: string;
}

export const FBR_SRO_SCHEDULES: SroScheduleEntry[] = [
  {
    value: "Sixth Schedule Table I",
    description: "Exempt domestic supplies — includes registered medicines, APIs, vaccines, blood products",
  },
  {
    value: "Sixth Schedule Table II",
    description: "Exempt imports — similar coverage for imported pharmaceutical goods",
  },
  {
    value: "Fifth Schedule",
    description: "Zero-rated supplies — specified goods for export and certain local supplies",
  },
  {
    value: "Eighth Schedule",
    description: "Goods chargeable at reduced rate (8%) — specified items",
  },
  {
    value: "Second Schedule",
    description: "Goods/services chargeable at rates other than standard rate",
  },
  {
    value: "SRO 1(I)/2020",
    description: "Tax exemption on COVID-19 related medical equipment and supplies",
  },
  {
    value: "SRO 551(I)/2008",
    description: "Exemption on pharmaceutical raw materials and specified medicines",
  },
  {
    value: "SRO 678(I)/2004",
    description: "Exemption on certain pharmaceutical products",
  },
  {
    value: "SRO 1125(I)/2011",
    description: "Reduced rate on specific medical devices",
  },
  {
    value: "SRO 562(I)/2008",
    description: "Zero-rating on drugs and medical equipment for charitable hospitals",
  },
];

// ── SRO Schedule Items ────────────────────────────────────────────────────────
export interface SroItemEntry {
  serial: string;
  schedule: string;
  description: string;
}

export const FBR_SRO_ITEMS: SroItemEntry[] = [
  // Sixth Schedule Table I — Exempt supplies
  { serial: "1", schedule: "Sixth Schedule Table I", description: "Drugs/medicines/vaccines/diagnostics registered by DRAP" },
  { serial: "2", schedule: "Sixth Schedule Table I", description: "Active Pharmaceutical Ingredients (APIs) used in manufacture of medicines" },
  { serial: "3", schedule: "Sixth Schedule Table I", description: "Vaccines for human use registered by DRAP" },
  { serial: "4", schedule: "Sixth Schedule Table I", description: "Blood and blood products (whole blood, plasma, clotting factors)" },
  { serial: "5", schedule: "Sixth Schedule Table I", description: "Surgical / medical instruments and apparatus (HS 9018)" },
  { serial: "6", schedule: "Sixth Schedule Table I", description: "Orthopaedic appliances and prosthetics (HS 9021)" },
  { serial: "7", schedule: "Sixth Schedule Table I", description: "Diagnostic kits / reagents for human diseases (HS 3822)" },
  { serial: "8", schedule: "Sixth Schedule Table I", description: "Sterile dressings, sutures and catgut (HS 3005)" },
  { serial: "9", schedule: "Sixth Schedule Table I", description: "Baby formula / infant food (HS 1901.10)" },
  { serial: "10", schedule: "Sixth Schedule Table I", description: "Contraceptives — condoms, IUDs, oral contraceptives" },
  { serial: "11", schedule: "Sixth Schedule Table I", description: "Hearing aids and accessories" },
  { serial: "12", schedule: "Sixth Schedule Table I", description: "Wheelchairs and mobility aids for disabled persons" },
  { serial: "13", schedule: "Sixth Schedule Table I", description: "Syringes (HS 9018.31) — for pharmaceutical use" },
  { serial: "14", schedule: "Sixth Schedule Table I", description: "Disposable surgical gloves (HS 4015.11)" },
  { serial: "15", schedule: "Sixth Schedule Table I", description: "Insulin and insulin delivery devices" },
  { serial: "16", schedule: "Sixth Schedule Table I", description: "Nutritional supplements for infants and children registered by DRAP" },
  { serial: "17", schedule: "Sixth Schedule Table I", description: "Herbal medicines registered by DRAP" },
  { serial: "18", schedule: "Sixth Schedule Table I", description: "Homeopathic medicines registered by DRAP" },
  { serial: "19", schedule: "Sixth Schedule Table I", description: "Cancer treatment drugs notified by Health Division" },
  { serial: "20", schedule: "Sixth Schedule Table I", description: "HIV/AIDS antiretroviral medicines" },
  // Sixth Schedule Table II — Exempt imports
  { serial: "1", schedule: "Sixth Schedule Table II", description: "Imported medicines registered with DRAP" },
  { serial: "2", schedule: "Sixth Schedule Table II", description: "Imported APIs for pharmaceutical manufacture" },
  { serial: "3", schedule: "Sixth Schedule Table II", description: "Imported vaccines and biological products" },
  { serial: "4", schedule: "Sixth Schedule Table II", description: "Imported medical / surgical devices (HS 9018)" },
  { serial: "5", schedule: "Sixth Schedule Table II", description: "Imported diagnostic reagents and kits (HS 3822)" },
  // Fifth Schedule — Zero-rated
  { serial: "1", schedule: "Fifth Schedule", description: "Goods exported from Pakistan" },
  { serial: "2", schedule: "Fifth Schedule", description: "Supplies to diplomats / diplomatic missions" },
  { serial: "3", schedule: "Fifth Schedule", description: "Goods supplied to UN organisations and NGOs under agreements" },
  // Eighth Schedule — Reduced rate
  { serial: "1", schedule: "Eighth Schedule", description: "Specified goods at 8% sales tax rate" },
  { serial: "2", schedule: "Eighth Schedule", description: "Edible oils, ghee and cooking oil (8%)" },
  { serial: "3", schedule: "Eighth Schedule", description: "Certain packing materials at reduced rate" },
];
