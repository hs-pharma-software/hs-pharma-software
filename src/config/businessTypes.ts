/**
 * The ten POS business types a tenant can be. Each definition is the
 * requirements analysis for that type (fields, rules, workflow) and also
 * drives the app: default sidebar sections for a new tenant of that type and
 * which capabilities are core / optional / not required.
 *
 * `status` is honest about this codebase: "ready" = the type's core workflow
 * runs on modules that exist today; "partial" = usable now with gaps listed
 * in `planned`; "planned" = only the shared POS (billing, FBR, cash, reports)
 * works today, its own modules are still to be built.
 */

export type FieldRule = "REQUIRED" | "OPTIONAL" | "CONDITIONAL" | "NOT APPLICABLE";
export type Level = "Core" | "Optional" | "Not Required";
export type Family = "pharmacy" | "retail" | "clinic" | "hospital";

export interface TypeField {
  label: string;
  rule: FieldRule;
  /** Where the value lives: item master, batch, serial unit, service, recipe... */
  level?: string;
  note?: string;
}

export interface EntryForm {
  title: string;
  fields: TypeField[];
}

export type CapabilityKey =
  | "inventory"
  | "batchExpiry"
  | "serials"
  | "recipes"
  | "services"
  | "patients"
  | "doctors"
  | "appointments"
  | "admissions"
  | "projects"
  | "pharmacy"
  | "digitalInvoicing";

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  inventory: "Inventory",
  batchExpiry: "Batch & expiry",
  serials: "Serial numbers & warranty",
  recipes: "Recipes & ingredients",
  services: "Service billing",
  patients: "Patient management",
  doctors: "Doctor management",
  appointments: "Appointments",
  admissions: "Admissions & beds",
  projects: "Projects / jobs",
  pharmacy: "Pharmacy controls",
  digitalInvoicing: "FBR Digital Invoicing",
};

export interface BusinessTypeDef {
  id: string;
  label: string;
  family: Family;
  status: "ready" | "partial" | "planned";
  purpose: string;
  workflow: string[];
  capabilities: Record<CapabilityKey, Level>;
  productForm: EntryForm | null;
  serviceForm: EntryForm | null;
  notApplicable: string[];
  inventoryRules: string[];
  pricingRules: string[];
  units: string[];
  purchasing: string[];
  billing: string[];
  reports: string[];
  validations: string[];
  mvp: string[];
  advanced: string[];
  /** Sidebar sections (config/nav.ts module keys) a new tenant of this type gets. */
  defaultModules: string[];
  /** Type-specific modules not built yet. */
  planned: string[];
  /** Shared sections that never apply to this type (blocked even when a
   * plan or an admin lists them), e.g. the pharmacy catalog for restaurants. */
  excludedModules?: string[];
}

/** Shared screens built on the pharmacy product catalog. Business types with
 * their own catalog (restaurant menu, electric store) never use them. */
export const PHARMACY_CATALOG_MODULES = ["invoices", "quotation", "order", "purchase", "products", "stock", "salesman", "reports"];

/** Whether a business type may use a shared (non type-specific) section. */
export const moduleAllowedForType = (typeId: string | null | undefined, moduleKey: string) => !businessType(typeId).excludedModules?.includes(moduleKey);

export const FAMILY_LABELS: Record<Family, { label: string; blurb: string }> = {
  pharmacy: {
    label: "Pharmacy POS",
    blurb: "Regulated stock: every unit traces to a batch and expiry; controlled medicines need extra checks.",
  },
  retail: {
    label: "Retail POS",
    blurb: "The bill is the transaction: scan or pick items, bill, take payment. Stock rules vary by type.",
  },
  clinic: {
    label: "Clinic Management",
    blurb: "Service-first: the patient visit is the transaction, billed from consultations and procedures.",
  },
  hospital: {
    label: "Hospital Management",
    blurb: "Patient episodes (OPD, emergency, admission) collect charges from many departments before settlement.",
  },
};

const ALL_CORE_MODULES = ["dashboard", "invoices", "products", "customers", "cash_register", "banks", "expenses", "reports", "utilities", "settings"];
const m = (...extra: string[]) => [...ALL_CORE_MODULES, ...extra];

const F = (label: string, rule: FieldRule, level?: string, note?: string): TypeField => ({ label, rule, level, note });

// Shared FBR Digital Invoicing fields: every type can submit invoices to FBR
// when the tenant is registered and the Super Admin allows it.
const FBR_ITEM_FIELDS: TypeField[] = [
  F("HS Code", "CONDITIONAL", "Item master", "Required when FBR Digital Invoicing is on"),
  F("FBR Sale Type", "CONDITIONAL", "Item master", "Required when FBR Digital Invoicing is on"),
  F("FBR Rate %", "CONDITIONAL", "Item master", "Must match FBR's rate for the sale type"),
  F("FBR UOM", "CONDITIONAL", "Item master", "Must be allowed for the HS code"),
  F("SRO Schedule / Item Serial", "CONDITIONAL", "Item master", "Only for reduced-rate or exempt items"),
];

const FBR_SERVICE_FIELDS: TypeField[] = [
  F("Tax profile (FBR / provincial)", "CONDITIONAL", "Service", "Services are mostly provincial (PRA, SRB, KPRA, BRA); FBR DI when the service is federally taxable"),
  F("HS / service code", "CONDITIONAL", "Service", "Required when the invoice goes to FBR DI"),
];

const PHARMA_MASTER: TypeField[] = [
  F("Product name (brand + strength + form)", "REQUIRED", "Item master"),
  F("Generic name", "REQUIRED", "Item master"),
  F("Strength", "REQUIRED", "Item master"),
  F("Dosage form", "REQUIRED", "Item master", "Tablet, capsule, syrup, injection..."),
  F("Manufacturer / company", "REQUIRED", "Item master"),
  F("DRAP registration no", "OPTIONAL", "Item master"),
  F("Barcode", "OPTIONAL", "Item master"),
  F("Base unit / pack unit + conversion", "REQUIRED", "Item master", "e.g. 1 box = 10 strips = 100 tablets"),
  F("Category / sub-category", "OPTIONAL", "Item master"),
  F("Prescription required", "OPTIONAL", "Item master"),
  F("Controlled / narcotic class", "CONDITIONAL", "Item master", "Detected from description; forces buyer name + mobile"),
  F("Reorder level / max stock", "OPTIONAL", "Item master"),
  F("Storage condition (cold chain)", "OPTIONAL", "Item master"),
];

const PHARMA_BATCH: TypeField[] = [
  F("Batch no", "REQUIRED", "Batch"),
  F("Expiry date", "REQUIRED", "Batch"),
  F("Quantity on hand", "REQUIRED", "Batch"),
  F("Purchase cost", "REQUIRED", "Batch"),
  F("Sale price / MRP", "REQUIRED", "Batch", "MRP can differ between batches"),
  F("Stock location", "OPTIONAL", "Batch"),
  F("Supplier", "OPTIONAL", "Batch"),
];

const c = (
  inventory: Level, batchExpiry: Level, serials: Level, recipes: Level, services: Level, patients: Level,
  doctors: Level, appointments: Level, admissions: Level, projects: Level, pharmacy: Level
): Record<CapabilityKey, Level> => ({
  inventory, batchExpiry, serials, recipes, services, patients, doctors, appointments, admissions, projects, pharmacy,
  digitalInvoicing: "Optional",
});

export const BUSINESS_TYPES: BusinessTypeDef[] = [
  {
    id: "retail_pharmacy",
    label: "Retail Pharmacy",
    family: "pharmacy",
    status: "ready",
    purpose: "Licensed pharmacy selling medicines and healthcare products to the public, with batch, expiry and controlled-drug checks.",
    workflow: ["Purchase with batch + expiry", "Scan / search product", "Earliest-expiry batch picked", "Bill (cash / credit)", "Controlled drug: buyer name + mobile", "FBR submission (if registered)"],
    capabilities: c("Core", "Core", "Not Required", "Not Required", "Optional", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Core"),
    productForm: { title: "Medicine entry", fields: [...PHARMA_MASTER, ...PHARMA_BATCH, ...FBR_ITEM_FIELDS] },
    serviceForm: null,
    notApplicable: ["Serial numbers", "Recipes", "Tables / KOT", "Admissions", "Projects"],
    inventoryRules: ["Every stock unit belongs to a batch with expiry", "Sell earliest expiry first; overriding needs a reason", "Expired batches cannot be sold", "Near-expiry alert by configurable days"],
    pricingRules: ["Retail price follows printed MRP", "Optional flat discount % per tenant or category", "Loose-unit price derived from pack price"],
    units: ["Box → strip → tablet", "Bottle (ml)", "Vial / ampoule"],
    purchasing: ["Supplier invoice no", "Batch, expiry, bonus qty per line", "Purchase return of near-expiry stock"],
    billing: ["Retail / wholesale invoice", "Sale in pack or loose units", "Item return / invoice return", "Memorized (draft) invoices", "Thermal / A5 / A4 print"],
    reports: ["Sales, profit by product / company / category", "Expiry and low-stock reports", "Narcotics register", "Tax reports"],
    validations: ["Quantity ≤ batch stock", "No sale from expired batch", "Narcotic line requires buyer name + mobile", "FBR fields valid before submission"],
    mvp: ["Medicine master + batches", "POS billing", "Purchases", "Expiry alerts", "FBR DI"],
    advanced: ["Prescription capture", "Loyalty", "Online store sync", "Multi-branch transfers"],
    defaultModules: m("quotation", "order", "purchase", "stock", "suppliers", "staff", "other_revenue", "tasks", "salesman"),
    planned: ["Prescription reference on bill"],
  },
  {
    id: "medical_store",
    label: "Medical Store",
    family: "pharmacy",
    status: "ready",
    purpose: "Smaller licensed outlet selling medicines, surgical supplies, healthcare products and basic medical equipment.",
    workflow: ["Purchase", "Scan / search", "Batch picked (where tracked)", "Bill", "Restricted-item check"],
    capabilities: c("Core", "Core", "Optional", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Core"),
    productForm: {
      title: "Medicine / healthcare product entry",
      fields: [
        ...PHARMA_MASTER.map((f) => (f.label === "Generic name" || f.label === "Strength" || f.label === "Dosage form" ? { ...f, rule: "CONDITIONAL" as FieldRule, note: "Required for medicines; not for surgical or healthcare goods" } : f)),
        F("Product kind", "REQUIRED", "Item master", "Medicine / surgical / healthcare / equipment"),
        ...PHARMA_BATCH.map((f) => (f.label === "Batch no" || f.label === "Expiry date" ? { ...f, rule: "CONDITIONAL" as FieldRule, note: "Required for medicines and dated supplies" } : f)),
        F("Serial no + warranty", "CONDITIONAL", "Serial unit", "BP monitors, glucometers and similar equipment"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: null,
    notApplicable: ["Recipes", "Tables / KOT", "Admissions", "Projects", "Doctors"],
    inventoryRules: ["Batch + expiry for medicines and dated supplies", "Equipment may be serial-tracked", "Restricted medicines limited by licence class (configurable list)"],
    pricingRules: ["MRP-based retail", "Discount % per item or bill"],
    units: ["Box → strip → tablet", "Pieces for surgical items"],
    purchasing: ["Supplier, batch, expiry, bonus"],
    billing: ["Retail invoice", "Returns", "Thermal receipt"],
    reports: ["Sales and profit", "Expiry", "Low stock"],
    validations: ["Restricted item blocked when above licence class (once configured)", "No expired sale"],
    mvp: ["Same as Retail Pharmacy with a simpler form"],
    advanced: ["Equipment warranty tracking", "Licence-class restriction lists per province"],
    defaultModules: m("purchase", "stock", "suppliers", "staff", "order"),
    planned: ["Licence-class restricted list", "Serial / warranty for equipment"],
  },
  {
    id: "hospital_pharmacy",
    label: "Hospital Pharmacy",
    family: "pharmacy",
    status: "partial",
    purpose: "Pharmacy inside a hospital supplying OPD patients at the counter, admitted patients against their account, and wards/departments.",
    workflow: ["Receive into main store", "Transfer to OPD pharmacy / ward stores", "OPD: dispense and bill", "IPD: issue to patient, charge to admission", "Ward requisitions and returns", "Controlled-drug register"],
    capabilities: c("Core", "Core", "Not Required", "Not Required", "Optional", "Core", "Optional", "Not Required", "Optional", "Not Required", "Core"),
    productForm: {
      title: "Hospital medicine entry",
      fields: [
        ...PHARMA_MASTER,
        F("Formulary status", "OPTIONAL", "Item master"),
        F("High-alert medicine", "OPTIONAL", "Item master"),
        F("Default store location", "REQUIRED", "Item master"),
        F("Preferred supplier", "OPTIONAL", "Item master"),
        ...PHARMA_BATCH.map((f) => (f.label === "Stock location" ? { ...f, rule: "REQUIRED" as FieldRule, note: "Main store, OPD pharmacy, each ward store" } : f)),
        F("Patient charge price", "REQUIRED", "Batch"),
        F("Prescription reference", "CONDITIONAL", "Issue record", "Required for IPD issues and controlled drugs"),
        F("Patient / admission", "CONDITIONAL", "Issue record", "Required for patient-linked dispensing"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: null,
    notApplicable: ["Serial numbers", "Recipes", "Tables / KOT", "Projects"],
    inventoryRules: ["Stock per location (main store, OPD, wards)", "Transfers are paired out/in movements", "IPD returns only if batch intact and not expired", "Controlled drugs keep a running balance per location"],
    pricingRules: ["Patient charge price per batch", "Panel / insurer price lists (advanced)"],
    units: ["Box → strip → tablet", "Vial, ampoule, ml"],
    purchasing: ["GRN into main store", "Reorder per location"],
    billing: ["OPD counter invoice", "IPD issue slip posted to patient account", "Patient return credit", "Ward requisition (cost center, not billed)"],
    reports: ["Issues by ward / department", "Stock valuation per location", "Expiry per location", "Controlled-drug register"],
    validations: ["IPD issue needs patient + prescription", "Controlled drug needs prescriber and authoriser", "Cannot issue expired batch"],
    mvp: ["OPD dispensing", "Stock with batches", "Ward transfers", "Expiry alerts"],
    advanced: ["Patient-account posting", "Formulary", "Unit-dose dispensing"],
    defaultModules: m("order", "purchase", "stock", "suppliers", "staff", "tasks"),
    planned: ["Locations & ward transfers", "Patient-linked IPD issue", "Controlled-drug authorisation"],
  },
  {
    id: "general_store",
    label: "General Store",
    family: "retail",
    status: "ready",
    purpose: "Grocery / FMCG retail with fast barcode billing, variants, weighed items and promotions.",
    workflow: ["Purchase", "Scan barcode (or scale label)", "Bill", "Payment", "Receipt"],
    capabilities: c("Core", "Optional", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required"),
    productForm: {
      title: "Store product entry",
      fields: [
        F("Product name", "REQUIRED", "Item master"),
        F("Barcode(s)", "REQUIRED", "Item master", "Several barcodes per item allowed"),
        F("Brand", "OPTIONAL", "Item master"),
        F("Size / variant", "OPTIONAL", "Item master"),
        F("Category / sub-category", "REQUIRED", "Item master"),
        F("Unit (pcs / kg / litre) + pack conversion", "REQUIRED", "Item master"),
        F("Weighed item + PLU code", "CONDITIONAL", "Item master", "Loose items sold by weight"),
        F("Printed retail price (MRP)", "CONDITIONAL", "Item master", "Required for Third Schedule goods"),
        F("Sale price", "REQUIRED", "Price list"),
        F("Purchase cost", "REQUIRED", "Batch"),
        F("Quantity on hand", "REQUIRED", "Batch"),
        F("Batch / expiry", "CONDITIONAL", "Batch", "Perishables only (dairy, bakery, baby food)"),
        F("Reorder level", "OPTIONAL", "Item master"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: null,
    notApplicable: ["Generic name / strength / DRAP", "Prescriptions", "Patients", "Doctors", "Recipes", "Admissions"],
    inventoryRules: ["Expiry tracking only for perishables", "Weighed items stocked in kg", "Reorder alerts"],
    pricingRules: ["Third Schedule goods: tax on printed retail price", "Promotions: buy X get Y, bundle price", "Member price (advanced)"],
    units: ["Carton → pack → piece", "kg / g for loose items"],
    purchasing: ["Supplier, cost, quantity", "Expiry for perishables"],
    billing: ["Fast scan loop", "Hold / recall bill", "Multiple payment methods", "Thermal receipt"],
    reports: ["Item sales", "Category sales", "Profit", "Low stock", "Expiry (perishables)"],
    validations: ["Unique barcode per tenant", "Weighed item needs PLU", "MRP required for Third Schedule items"],
    mvp: ["Barcode billing", "Purchases", "Stock", "FBR DI"],
    advanced: ["Scale barcodes", "Promotions engine", "Loyalty"],
    defaultModules: m("purchase", "stock", "suppliers", "staff", "other_revenue"),
    planned: ["Scale barcode parsing", "Promotions"],
  },
  {
    id: "contractor",
    label: "Contractor — Simple POS for Digital Invoicing",
    family: "retail",
    status: "partial",
    purpose: "Contractors and suppliers who mainly need compliant invoices for clients, projects and jobs, with optional materials.",
    workflow: ["Client", "Project / job", "Quotation", "Invoice (labour + materials)", "Partial payments", "Outstanding balance", "PDF / digital invoice"],
    capabilities: c("Optional", "Not Required", "Not Required", "Not Required", "Core", "Not Required", "Not Required", "Not Required", "Not Required", "Optional", "Not Required"),
    productForm: {
      title: "Material entry (optional)",
      fields: [
        F("Material name", "REQUIRED", "Item master"),
        F("Unit (pcs, bag, ft, m, kg)", "REQUIRED", "Item master"),
        F("Rate", "REQUIRED", "Price list"),
        F("Cost", "OPTIONAL", "Item master"),
        F("Track stock", "OPTIONAL", "Item master", "Off by default"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: {
      title: "Labour / service entry",
      fields: [
        F("Service code", "REQUIRED", "Service"),
        F("Service name / work description", "REQUIRED", "Service"),
        F("Billing unit (job, hour, day, sq ft, running ft, trip, lump sum)", "REQUIRED", "Service"),
        F("Standard rate", "REQUIRED", "Service"),
        F("Category", "OPTIONAL", "Service"),
        F("Active / inactive", "REQUIRED", "Service"),
        ...FBR_SERVICE_FIELDS,
      ],
    },
    notApplicable: ["Batch / expiry", "Serial numbers", "Patients", "Doctors", "Recipes", "Tables / KOT"],
    inventoryRules: ["Inventory optional; materials can be non-stock"],
    pricingRules: ["Rate per unit", "Quoted rates per project", "Discount per invoice"],
    units: ["Job, hour, day, sq ft, running ft, trip, lump sum"],
    purchasing: ["Optional material purchases"],
    billing: ["Quotation → invoice", "Partial payments", "Outstanding balance per client", "Withholding deductions shown on invoice", "PDF / digital sharing"],
    reports: ["Client ledgers", "Project revenue", "Receivables ageing", "Tax summary"],
    validations: ["Buyer NTN/CNIC for registered clients", "At least one line", "Tax profile set when submitting to FBR"],
    mvp: ["Clients", "Service items", "Quotation", "Invoice", "Payments", "FBR DI"],
    advanced: ["Projects with BOQ", "Running / progress bills", "Retention money", "Mobilisation advance"],
    defaultModules: m("quotation", "staff"),
    planned: ["Service items (non-stock)", "Projects / jobs", "Running bills & retention"],
  },
  {
    id: "restaurant",
    label: "Restaurant",
    family: "retail",
    status: "ready",
    purpose: "Food service selling menu items (dine-in, takeaway, delivery) made from ingredients.",
    workflow: ["Open table / order", "Add items + modifiers", "KOT to kitchen", "Running bill", "Bill + service charge", "Payment", "Close table"],
    capabilities: c("Core", "Optional", "Not Required", "Core", "Optional", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required"),
    productForm: {
      title: "Menu item entry",
      fields: [
        F("Item name", "REQUIRED", "Menu item"),
        F("Menu category (starters, mains, drinks)", "REQUIRED", "Menu item"),
        F("Price (dine-in / takeaway / delivery)", "REQUIRED", "Menu item", "Can differ per mode"),
        F("Portion sizes", "OPTIONAL", "Menu item"),
        F("Modifiers (spice, extra cheese) + price", "OPTIONAL", "Menu item"),
        F("Kitchen station", "REQUIRED", "Menu item", "Decides which printer gets the KOT"),
        F("Recipe (ingredients per portion + wastage %)", "OPTIONAL", "Recipe", "Needed for ingredient stock and food cost"),
        F("Availability schedule", "OPTIONAL", "Menu item"),
        F("Ingredient: name, purchase unit, recipe unit + conversion", "CONDITIONAL", "Ingredient", "When recipes are used"),
        F("Ingredient: cost, stock, expiry", "CONDITIONAL", "Ingredient batch"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: null,
    notApplicable: ["Generic name / DRAP", "Serial numbers", "Patients", "Doctors", "Admissions", "Projects"],
    inventoryRules: ["Menu items hold no stock", "Ingredients deducted by recipe on sale / KOT", "Wastage recorded with reason"],
    pricingRules: ["Price per order mode", "Deals / combos", "Service charge (dine-in)", "Discount needs permission"],
    units: ["kg → g, litre → ml, crate → pcs for ingredients"],
    purchasing: ["Ingredient purchases with cost", "Expiry for perishables"],
    billing: ["KOT per station", "Running table bill", "Split bill", "Void with reason", "Provincial tax per payment method (configurable)"],
    reports: ["Item sales", "Food cost %", "Theoretical vs actual consumption", "Waiter sales", "Voids"],
    validations: ["KOT void needs reason + permission", "Recipe units convertible to stock units"],
    mvp: ["Menu items", "Takeaway billing", "Thermal receipt", "FBR DI / provincial tax"],
    advanced: ["Tables + KOT", "Recipes + ingredient deduction", "Delivery riders", "Kitchen display"],
    // Restaurant sections follow the business type (config/nav.ts onlyFor);
    // pharmacy stock/purchase screens are not needed.
    defaultModules: ["dashboard", "customers", "staff", "cash_register", "banks", "expenses", "other_revenue", "utilities", "settings"],
    excludedModules: PHARMACY_CATALOG_MODULES,
    planned: ["Multi-branch menus and pricing", "Reservations", "Kitchen display screen per station (separate device)"],
  },
  {
    id: "electronics_solar",
    label: "Electric / Electronics / Solar Store",
    family: "retail",
    status: "ready",
    purpose: "Electrical goods, electronics and solar equipment with serial numbers, warranties, technical specs and installation services.",
    workflow: ["Purchase with serials", "Quotation (solar system)", "Advance", "Invoice with serials", "Installation job", "Warranty card", "Warranty claim / repair"],
    capabilities: c("Core", "Not Required", "Core", "Not Required", "Core", "Not Required", "Not Required", "Not Required", "Not Required", "Optional", "Not Required"),
    productForm: {
      title: "Electrical / solar product entry",
      fields: [
        F("Product name", "REQUIRED", "Item master"),
        F("Brand", "REQUIRED", "Item master"),
        F("Model", "REQUIRED", "Item master"),
        F("Category (panel, inverter, battery, cable, appliance)", "REQUIRED", "Item master"),
        F("Technical specs (W, V, kWh, phase, efficiency, inverter type)", "CONDITIONAL", "Item master", "Per category"),
        F("Serial tracked", "REQUIRED", "Item master"),
        F("Serial no / IMEI", "CONDITIONAL", "Serial unit", "Required on purchase and sale when serial tracked"),
        F("Warranty months (shop / manufacturer)", "OPTIONAL", "Item master"),
        F("Unit (pcs, metre, roll)", "REQUIRED", "Item master"),
        F("Purchase cost / sale price", "REQUIRED", "Batch / price list"),
        F("Barcode", "OPTIONAL", "Item master"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: {
      title: "Installation / repair service entry",
      fields: [
        F("Service name", "REQUIRED", "Service"),
        F("Billing unit (job, kW, metre, visit)", "REQUIRED", "Service"),
        F("Rate", "REQUIRED", "Service"),
        F("Technician", "OPTIONAL", "Service"),
        ...FBR_SERVICE_FIELDS,
      ],
    },
    notApplicable: ["Batch / expiry", "Generic name / DRAP", "Patients", "Doctors", "Recipes", "Tables / KOT"],
    inventoryRules: ["Serial-tracked items: each unit has a serial and status", "Cables in metres / rolls", "Serial must be unique per item"],
    pricingRules: ["Package price for solar systems", "Instalments (advanced)", "Discount per line"],
    units: ["pcs", "metre / roll", "kW (system size)"],
    purchasing: ["Serials captured on receipt", "Warranty from supplier"],
    billing: ["Invoice prints serials + warranty end date", "Quotation → advance → final invoice", "Installation charges"],
    reports: ["Serial lookup", "Warranty expiry", "Brand / category sales", "Installation jobs"],
    validations: ["Serial scanned for serial-tracked lines", "Serial not already sold"],
    mvp: ["Products with specs", "Quotation", "Invoice", "Installation as line", "FBR DI"],
    advanced: ["Serial & warranty tracking", "Repair job cards", "Instalment plans", "Solar system packages"],
    // Own catalog, sales, purchases, stock and parties come from the store
    // module (config/nav.ts onlyFor); pharmacy product/stock screens are not used.
    defaultModules: ["dashboard", "cash_register", "banks", "expenses", "staff", "utilities", "settings"],
    excludedModules: PHARMACY_CATALOG_MODULES,
    planned: ["Installation / service items", "Repair job cards", "Instalment plans", "Branch-wise stock"],
  },
  {
    id: "distributor",
    label: "Wholesaler / Distributor (Pharma or General)",
    family: "retail",
    status: "ready",
    purpose: "Distribution business in Pharma or General mode: companies and their catalogs, field salesmen with location-checked bookings, credit invoicing with ATL-based withholding tax, targets and recovery.",
    workflow: ["Salesman shares location", "Books order at the customer", "Admin approves", "Booking -> invoice (236G / 236H withholding)", "Delivery & recovery", "Returns / credit notes"],
    capabilities: c("Core", "Core", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Not Required", "Optional"),
    productForm: {
      title: "Distribution product entry",
      fields: [
        F("Company", "REQUIRED", "Product"),
        F("Product code", "REQUIRED", "Product", "Unique per distributor"),
        F("Name, unit, pack size", "REQUIRED", "Product"),
        F("Generic, strength, dosage form, DRAP reg.", "CONDITIONAL", "Product", "Pharma mode"),
        F("Brand, size", "OPTIONAL", "Product", "General mode"),
        F("Trade price, retail price, cost, sales tax %", "REQUIRED", "Price"),
      ],
    },
    serviceForm: null,
    notApplicable: ["Patients", "Doctors", "Tables / KOT", "Recipes", "Serial numbers"],
    inventoryRules: ["Stock per product, no negative stock unless allowed", "Purchases add, sales and purchase returns deduct"],
    pricingRules: ["Trade price per product", "Price change / discount only with permission"],
    units: ["Pack / box / carton as configured per product"],
    purchasing: ["Purchases from suppliers (principals) with field-level permissions", "Purchase returns"],
    billing: ["Bookings by location-sharing salesmen", "Approval", "Credit invoices with WHT snapshot", "Credit notes instead of edits"],
    reports: ["Company / category / salesman / customer sales", "Withholding tax collected", "Booking conversion", "Receivables / payables"],
    validations: ["Fresh accurate location to submit a booking", "Pharma: CDSL number and expiry", "ATL status recorded with source and date"],
    mvp: ["Companies & catalog", "Customers with geotag", "Salesmen, targets, location", "Bookings -> invoices", "WHT"],
    advanced: ["Live salesman map", "Permission matrix per sub-user", "Audit log"],
    // Distribution sections come from config/nav.ts onlyFor; pharmacy catalog screens are not used.
    defaultModules: ["dashboard", "cash_register", "banks", "expenses", "staff", "utilities", "settings"],
    excludedModules: PHARMACY_CATALOG_MODULES,
    planned: ["Batch / expiry stock per product", "Delivery challans and van loads", "Bonus schemes and principal claims", "Background tracking app (native)"],
  },
  {
    id: "hospital",
    label: "Hospital Management / Hospital POS",
    family: "hospital",
    status: "planned",
    purpose: "Hospital operations and billing: OPD, emergency, admissions, diagnostics, wards and an attached pharmacy, billed per patient episode.",
    workflow: ["Register patient (MR no)", "OPD / emergency / admission episode", "Services and pharmacy issues posted to episode", "Deposits", "Interim bill", "Discharge: final bill, deposit adjustment, clearance"],
    capabilities: c("Core", "Core", "Optional", "Not Required", "Core", "Core", "Core", "Optional", "Optional", "Not Required", "Core"),
    productForm: {
      title: "Hospital item entry",
      fields: [
        F("Item kind", "REQUIRED", "Item master", "Medicine / consumable / reusable equipment / fixed asset"),
        F("Medicine fields (generic, strength, form...)", "CONDITIONAL", "Item master", "Medicines only"),
        F("Batch + expiry", "CONDITIONAL", "Batch", "Medicines and dated consumables"),
        F("Serial / asset tag", "CONDITIONAL", "Asset", "Reusable equipment and fixed assets"),
        F("Department / cost center", "REQUIRED", "Item master"),
        F("Saleable to patient", "REQUIRED", "Item master", "Assets are not saleable"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: {
      title: "Hospital service entry",
      fields: [
        F("Service code", "REQUIRED", "Service"),
        F("Service name", "REQUIRED", "Service"),
        F("Department", "REQUIRED", "Service"),
        F("Service category (consultation, bed, room, nursing, lab, imaging, procedure, OT, admin)", "REQUIRED", "Service"),
        F("Standard rate", "REQUIRED", "Service"),
        F("Rate by patient class / room category", "OPTIONAL", "Service rate"),
        F("Billing unit (visit, day, test, procedure, hour)", "REQUIRED", "Service"),
        F("Performing department", "OPTIONAL", "Service"),
        F("Cost center", "OPTIONAL", "Service"),
        F("Package pricing", "OPTIONAL", "Package"),
        F("Effective date of rate", "REQUIRED", "Service rate"),
        F("Doctor share rule", "OPTIONAL", "Service"),
        F("Active / inactive", "REQUIRED", "Service"),
        ...FBR_SERVICE_FIELDS,
      ],
    },
    notApplicable: ["Recipes", "Tables / KOT", "Projects"],
    inventoryRules: ["Services never enter the stock table", "Medicines: batch + expiry", "Consumables: stock, expiry if dated", "Reusable equipment / fixed assets: asset register, not saleable stock"],
    pricingRules: ["Rate matrix by patient class / room", "Panel / insurer tariffs (advanced)", "Packages with limits", "Rate changes by effective date"],
    units: ["Visit, day, test, procedure, hour", "Medicines: box → strip → tablet"],
    purchasing: ["Central store receipt", "Department requisitions"],
    billing: ["OPD bill", "Emergency bill", "Inpatient running bill + final bill", "Pharmacy and lab bills", "Deposits, partial payments, refunds", "Department-wise revenue"],
    reports: ["Department revenue", "Doctor shares", "Bed occupancy", "Service utilisation", "Patient billing history", "Outstanding"],
    validations: ["Episode open before charges post", "Discharge blocked until balance settled or approved", "Refund needs approval", "Clinical data visible to clinical roles only"],
    mvp: ["Patient registration", "Service master", "OPD billing", "Pharmacy", "Deposits & receipts"],
    advanced: ["Admissions & beds", "Daily auto charges", "Lab / imaging orders", "OT", "Packages", "Panels / insurance"],
    defaultModules: m("purchase", "stock", "suppliers", "staff", "other_revenue", "tasks"),
    planned: ["Patients (MR no) & episodes", "Hospital service master", "OPD / IPD / emergency billing", "Admissions, wards & beds", "Lab & imaging orders"],
  },
  {
    id: "clinic",
    label: "Clinic Management / Clinic POS",
    family: "clinic",
    status: "planned",
    purpose: "Independent clinics and small medical centres billing consultations and procedures, with optional appointments and optional inventory.",
    workflow: ["Walk-in or appointment", "Token / queue", "Consultation", "Procedures added", "Bill + payment", "Daily cash closing"],
    capabilities: c("Optional", "Optional", "Not Required", "Not Required", "Core", "Core", "Core", "Optional", "Not Required", "Not Required", "Optional"),
    productForm: {
      title: "Clinic stock item (optional)",
      fields: [
        F("Product name", "REQUIRED", "Item master"),
        F("SKU / barcode", "OPTIONAL", "Item master"),
        F("Unit", "REQUIRED", "Item master"),
        F("Purchase cost", "REQUIRED", "Batch"),
        F("Selling price", "CONDITIONAL", "Price list", "Only if sold to patients"),
        F("Batch / expiry", "CONDITIONAL", "Batch", "Medicines and dated consumables"),
        F("Quantity on hand / reorder level", "REQUIRED", "Batch / item"),
        F("Used in procedures", "OPTIONAL", "Item master"),
        ...FBR_ITEM_FIELDS,
      ],
    },
    serviceForm: {
      title: "Consultation / clinic service entry",
      fields: [
        F("Service code", "REQUIRED", "Service"),
        F("Service name", "REQUIRED", "Service"),
        F("Category (consultation, follow-up, procedure, test, certificate)", "REQUIRED", "Service"),
        F("Doctor or department", "CONDITIONAL", "Service", "Required for consultations"),
        F("Standard fee", "REQUIRED", "Service"),
        F("First-visit / follow-up fee + follow-up window (days)", "CONDITIONAL", "Doctor rate", "Consultations only; configurable rule"),
        F("Billing unit", "REQUIRED", "Service"),
        F("Duration", "OPTIONAL", "Service"),
        F("Doctor share", "OPTIONAL", "Service"),
        F("Active / inactive", "REQUIRED", "Service"),
        ...FBR_SERVICE_FIELDS,
      ],
    },
    notApplicable: ["Admissions & beds", "Recipes", "Tables / KOT", "Projects", "Serial numbers"],
    inventoryRules: ["Inventory optional: a clinic charging only fees needs no catalog", "Consultations are services, never stock"],
    pricingRules: ["Doctor fee separate from clinic service fee", "Follow-up fee within a configurable window", "Discount with permission"],
    units: ["Visit, session, procedure"],
    purchasing: ["Optional: medicines and consumables"],
    billing: ["Consultation + procedures on one invoice", "Partial payments and balances", "Refunds", "Receipt print / digital", "Daily cash closing"],
    reports: ["Doctor-wise revenue", "Service-wise revenue", "Patient payment history", "No-shows"],
    validations: ["Consultation line needs a doctor", "Follow-up fee only inside the window"],
    mvp: ["Patients", "Doctors & fees", "Walk-in billing", "Receipts", "Cash closing"],
    advanced: ["Appointments & reminders", "Queue display", "Prescription print", "Dispensary inventory"],
    defaultModules: m("staff"),
    planned: ["Patients & visits", "Doctors & consultation fees", "Clinic service master", "Appointments / tokens"],
  },
];

const LEGACY_LABELS: Record<string, string> = {
  "retail pharmacy": "retail_pharmacy",
  "medical store": "medical_store",
  "hospital pharmacy": "hospital_pharmacy",
  "wholesale / distributor": "wholesale_distributor",
  "general store": "general_store",
};

/** Type for a tenant's stored `business_type` (id, or a label saved by
 * earlier versions). Untyped tenants are treated as Retail Pharmacy. */
export function businessType(value: string | null | undefined): BusinessTypeDef {
  const v = (value ?? "").trim();
  return (
    BUSINESS_TYPES.find((t) => t.id === v) ??
    BUSINESS_TYPES.find((t) => t.id === LEGACY_LABELS[v.toLowerCase()]) ??
    BUSINESS_TYPES[0]
  );
}

/** Sections for a new tenant of this type, limited to what its plan includes. */
export function defaultModulesFor(type: BusinessTypeDef, planModules: string[]): string[] {
  return planModules.length ? type.defaultModules.filter((k) => planModules.includes(k)) : type.defaultModules;
}

export const STATUS_LABELS: Record<BusinessTypeDef["status"], { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-emerald-100 text-emerald-700" },
  partial: { label: "Partly ready", cls: "bg-amber-100 text-amber-800" },
  planned: { label: "Core POS only", cls: "bg-sky-100 text-sky-800" },
};
