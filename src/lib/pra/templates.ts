/** Ready-made PRA set-ups: choosing a vendor's service fills in its sector, tax
 * rule and starter services. Pure data, no imports.
 *
 * Only services with one clear classification code and one rate are listed.
 * Each was read from a consolidated copy of the Second Schedule (2026-27)
 * whose footnotes cite the Punjab Finance Act 2026; the Super Admin's approval
 * is recorded when a template is applied. */

export interface PraStarterService { name: string; unit: string }

export interface PraTemplate {
  id: string;
  label: string;
  sector: string;
  ruleKey: string;
  service: string;
  code: string;
  rate: number;
  inputAdjustment: string;
  source: string;
  clause: string;
  /** The contract decides whether this rate applies: a scope note is required. */
  needsScope: boolean;
  starters: PraStarterService[];
}

export const PRA_TEMPLATE_SOURCE_URL = "https://conseric.pk/wp-content/uploads/2026/07/pra-second-schedule-2026-27.pdf";
export const PRA_TEMPLATE_READ_ON = "2026-11-18";
export const PRA_TEMPLATE_REVIEW_NOTE = "Read from a consolidated copy of the Second Schedule (2026-27), not the official Gazette. Approved by the Super Admin through a vendor template.";
/** MAVIN's static outbound IP (the gateway) that PRA whitelists. */
export const PRA_GATEWAY_IP = "95.111.192.41";

const FA2026 = "as amended by the Punjab Finance Act 2026 (L of 2026), Punjab Gazette (Extraordinary) 1 July 2026, s.5k(ii)";

export const PRA_TEMPLATES: PraTemplate[] = [
  {
    id: "laundry", label: "Laundry and dry cleaning", sector: "laundry", ruleKey: "laundry-9811.0000",
    service: "Services provided by laundries and dry cleaners", code: "9811.0000", rate: 8,
    inputAdjustment: "Without input tax adjustment.", source: `Punjab Sales Tax on Services Act 2012, Second Schedule, Part III Sr. 19, ${FA2026} ("Five" to "Eight").`,
    clause: "Part III Sr. 19: Services provided by laundries and dry cleaners, 9811.0000: eight percent without input tax adjustment.", needsScope: false,
    starters: [
      { name: "Wash and Iron", unit: "Piece" }, { name: "Dry Cleaning", unit: "Piece" }, { name: "Ironing / Pressing", unit: "Piece" },
      { name: "Laundry by Weight", unit: "Kg" }, { name: "Blanket / Quilt Cleaning", unit: "Piece" },
    ],
  },
  {
    id: "contractor_private", label: "Construction contractor (private work)", sector: "contractor", ruleKey: "contractor-general-16",
    service: "Construction services and contractors (building, water / gas / sanitary, roads and bridges, electrical and mechanical, horticultural, multi-discipline): others", code: "9824.0000", rate: 16,
    inputAdjustment: "With input tax credit or adjustment.", source: "Punjab Sales Tax on Services Act 2012, Second Schedule, Part III Sr. 6.",
    clause: "Part III Sr. 6 (9824.0000 and 9814.2000): sixteen percent with input tax credit or adjustment for others.", needsScope: true,
    starters: [{ name: "Contract Work", unit: "Job" }, { name: "Labour Charges", unit: "Day" }],
  },
  {
    id: "contractor_govt", label: "Construction contractor (Government civil works)", sector: "contractor", ruleKey: "contractor-govt-civil-5",
    service: "Construction / contractor services: Government civil works", code: "9824.0000", rate: 5,
    inputAdjustment: "Without input tax credit or adjustment.", source: "Punjab Sales Tax on Services Act 2012, Second Schedule, Part III Sr. 6 and its Explanation.",
    clause: "Five percent without input tax credit or adjustment in respect of Government civil works.", needsScope: true,
    starters: [{ name: "Government Civil Work", unit: "Job" }],
  },
  {
    id: "photography", label: "Photography studio / event photographer", sector: "photography", ruleKey: "photography-9819.7000",
    service: "Services provided by photography studios and event or occasion photographers / film-makers", code: "9819.7000", rate: 5,
    inputAdjustment: "Without input tax adjustment.", source: "Punjab Sales Tax on Services Act 2012, Second Schedule, Part III Sr. 27.",
    clause: "Part III Sr. 27: photography studios and event or occasion photographers / film-makers, 9819.7000: five percent without input tax adjustment.", needsScope: false,
    starters: [{ name: "Studio Photo Session", unit: "Session" }, { name: "Event Photography", unit: "Event" }, { name: "Video Coverage", unit: "Event" }],
  },
  {
    id: "warehouse", label: "Warehouse / cold storage", sector: "warehouse", ruleKey: "warehouse-9833.0000",
    service: "Services provided by warehouses or depots for storage or cold storages, including letting of space for storage", code: "9833.0000", rate: 8,
    inputAdjustment: "Without input tax adjustment.", source: `Punjab Sales Tax on Services Act 2012, Second Schedule, Part III Sr. 25, ${FA2026} ("Five" to "Eight").`,
    clause: "Part III Sr. 25: warehouses or depots for storage or cold storages, 9833.0000: eight percent without input tax adjustment.", needsScope: false,
    starters: [{ name: "Warehouse Storage", unit: "Month" }, { name: "Cold Storage", unit: "Month" }],
  },
];

export const praTemplate = (id: unknown): PraTemplate | null => PRA_TEMPLATES.find((t) => t.id === id) ?? null;

/** Sectors billed on the shared invoice where each invoice is chosen as a PRA Invoice. */
export const PRA_INVOICE_SECTORS = [...new Set(PRA_TEMPLATES.map((t) => t.sector))];
