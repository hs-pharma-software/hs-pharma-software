/** Search titles, descriptions and main headings of the public website,
 * written for what people in Pakistan search ("pharmacy software Pakistan",
 * "FBR POS integration"...). Titles stay under about 60 characters with the
 * site name added; descriptions under 160. Only facts the product pages
 * already state; no prices, rankings or claims. */

export const SITE_NAME = "MAVIN.pk";

/** Per page: search title (the site name is appended), description, and the page's H1 where it changes. */
export const PAGE_SEO: Record<string, { title: string; description: string; h1?: string }> = {
  "/": {
    title: "POS & Business Software in Pakistan | MAVIN.pk",
    description: "MAVIN.pk is POS and business software for Pakistan: pharmacy, retail, clinic, lab, restaurant and distribution, with FBR Digital Invoicing.",
  },
  "/products": {
    title: "POS Software for Every Business in Pakistan",
    description: "MAVIN.pk products for pharmacies, general stores, mobile and cloth shops, restaurants, distributors, clinics, labs, hospitals and marquees.",
    h1: "POS and business software for every sector",
  },
  "/platform": {
    title: "Billing, Inventory & Accounting Software Platform",
    description: "One platform for billing, stock, purchasing, reports, users and permissions: works offline on Windows and online in the browser.",
  },
  "/integrations": {
    title: "FBR, PRA & DRAP Integrations for POS Software",
    description: "MAVIN.pk connects to FBR Digital Invoicing, provincial restaurant tax and DRAP product data, so invoices and records stay compliant.",
  },
  "/integrations/fbr-digital-invoicing": {
    title: "FBR Digital Invoicing POS Integration in Pakistan",
    description: "Send sale invoices to FBR Digital Invoicing from your POS: who needs it, what you need (NTN/STRN, PRAL token, HS codes) and how onboarding works.",
    h1: "FBR Digital Invoicing integration",
  },
  "/pricing": {
    title: "POS Software Price & Plans in Pakistan",
    description: "MAVIN.pk plans and prices in rupees for pharmacies, shops, clinics, labs and more, with add-ons: business website, online store and own domain.",
  },
  "/demo": {
    title: "Book a Free POS Software Demo",
    description: "Book a demo of MAVIN.pk for your business type: pharmacy, retail, clinic, lab, restaurant or distribution. We show the workflow you use.",
  },
  "/contact": {
    title: "Contact MAVIN.pk: POS Software Sargodha, Pakistan",
    description: "Contact MAVIN.pk about POS software, pricing, FBR setup or support. Phone 0316-0585858, Monday to Saturday, 9am to 6pm.",
    h1: "Contact MAVIN.pk",
  },
  "/resources": {
    title: "POS Software Guides & Resources",
    description: "Getting-started steps, product guides and FBR Digital Invoicing setup for MAVIN.pk POS and business software.",
  },
  "/help": {
    title: "Help & Support for MAVIN.pk Customers",
    description: "Help for MAVIN.pk customers: support by phone and email, Monday to Saturday, 9am to 6pm.",
  },
  "/about": {
    title: "About MAVIN.pk: Business Software from Pakistan",
    description: "MAVIN.pk builds billing, stock and business software for Pakistani pharmacies, shops, clinics, labs and distributors, from Sargodha, Punjab.",
  },
  "/privacy": { title: "Privacy Notice", description: "How MAVIN.pk handles enquiry details and business data: where it is kept, who it is shared with and how long enquiries are kept." },
  "/terms": { title: "Terms of Service", description: "The terms for using MAVIN.pk: subscription, renewal and grace period, fees, your data, acceptable use and governing law." },
  "/security": { title: "Security", description: "How MAVIN.pk protects business data: separate business records, logins and permissions, backups and how to report a security issue." },
};

/** Product pages: search title, description and H1 (the product page's sector headline stays below it). */
export const PRODUCT_SEO: Record<string, { title: string; description: string; h1: string }> = {
  "retail-pharmacy-pos": { title: "Pharmacy POS Software in Pakistan", h1: "Pharmacy POS software", description: "Pharmacy software for Pakistan: billing with batch and expiry tracking, earliest expiry first, controlled medicines, loose tablets and FBR invoicing." },
  "medical-store-pos": { title: "Medical Store Software in Pakistan", h1: "Medical store software", description: "Simple medical store software: medicines and surgical items with batch and expiry, fast billing, stock and purchases, and FBR Digital Invoicing." },
  "hospital-pharmacy": { title: "Hospital Pharmacy Software", h1: "Hospital pharmacy software", description: "Counter dispensing for a pharmacy inside a hospital: OPD patients, batch-tracked stock, prescriptions from the hospital and FBR invoicing." },
  "general-store-pos": { title: "General Store & Grocery POS Software", h1: "General store POS software", description: "Fast barcode billing for grocery, kiryana and general stores, with stock, purchases, reports and FBR Digital Invoicing in one place." },
  "contractor-invoicing": { title: "Invoicing Software for Contractors & Suppliers", h1: "Contractor invoicing software", description: "Quotations, sales tax invoices and payments for contractors and suppliers in Pakistan, with or without stock, and FBR Digital Invoicing." },
  "restaurant-pos": { title: "Restaurant POS Software in Pakistan", h1: "Restaurant POS software", description: "Restaurant POS for dine-in, takeaway and delivery: orders, kitchen tickets, bills and provincial restaurant tax, on Windows or the web." },
  "electronics-solar-pos": { title: "Electronics & Solar Shop POS Software", h1: "Electronics and solar shop POS software", description: "POS for electrical, electronics and solar shops: serial numbers, warranties, quotations for complete systems, stock and invoices." },
  "distribution-software": { title: "Distribution Software for Distributors", h1: "Distribution software", description: "Software for pharma and general distributors: company catalogues, salesman order booking, credit invoicing and recovery." },
  "mobile-shop-pos": { title: "Mobile Shop POS Software with IMEI", h1: "Mobile shop POS software", description: "Mobile phone shop software: every handset bought and sold by IMEI, accessories, buyer details on each sale, stock and reports." },
  "cloth-store-pos": { title: "Cloth & Garment Shop POS Software", h1: "Cloth shop POS software", description: "POS for garment and fabric shops: products by type, colour and size, a customer measurements book, billing and stock." },
  "clinic-management": { title: "Clinic Management Software in Pakistan", h1: "Clinic management software", description: "Clinic software for walk-ins and appointments: queue, consultations, procedures, prescriptions and billing for clinics and medical centres." },
  "diagnostic-lab-software": { title: "Diagnostic Lab Software (LIS) in Pakistan", h1: "Diagnostic lab software", description: "Lab software from reception to verified report: patient registration, samples, results, pathologist verification and online reports by QR code." },
  "hospital-management": { title: "Hospital Management Software in Pakistan", h1: "Hospital management software", description: "Hospital software that bills OPD, emergency and admissions against each patient's episode, with charges from every department." },
  "marquee-banquet-software": { title: "Marquee & Banquet Hall Booking Software", h1: "Marquee and banquet hall software", description: "Software for marquees and banquet halls: check dates and slots, book the hall, menu packages per head, extras and payments." },
};
