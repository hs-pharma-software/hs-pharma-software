/** Starting drafts per business type. They use only the business's own
 * details (name, phone, email, address); every other text is an instruction
 * for the owner to replace, so nothing about the business is invented. */
import { businessType } from "@/config/businessTypes";
import type { Section, SiteSettings } from "./sections";
import { DAYS } from "./sections";

export type TemplateId = "pharmacy" | "retail" | "clinic" | "hospital" | "lab" | "distributor" | "restaurant" | "events" | "general";

export const TEMPLATES: Record<TemplateId, { label: string; summary: string; store: boolean }> = {
  pharmacy: { label: "Pharmacy", summary: "Introduction, product catalogue, prescription upload at checkout, contact and order requests.", store: true },
  retail: { label: "Retail shop", summary: "Categories, featured products, cart and checkout.", store: true },
  clinic: { label: "Clinic", summary: "Doctors, services, timings and appointment requests.", store: false },
  hospital: { label: "Hospital", summary: "Departments, doctors, facilities and appointment requests.", store: false },
  lab: { label: "Diagnostic lab", summary: "Tests and services, timings and contact.", store: false },
  distributor: { label: "Distributor / supplier", summary: "Company profile, catalogue and quotation requests.", store: true },
  restaurant: { label: "Restaurant", summary: "Introduction, menu highlights, gallery and contact.", store: false },
  events: { label: "Events / banquet", summary: "Venue, packages, gallery and booking enquiries.", store: false },
  general: { label: "General business", summary: "Hero, about, services, gallery and contact.", store: false },
};

/** The template for a business type, with a sensible fallback. */
export function templateFor(typeId: string | null | undefined): TemplateId {
  const t = businessType(typeId);
  if (t.id === "distributor") return "distributor";
  if (t.id === "restaurant") return "restaurant";
  if (t.id === "contractor") return "general";
  if (t.family === "pharmacy") return "pharmacy";
  if (t.family === "retail") return "retail";
  if (t.family === "clinic") return "clinic";
  if (t.family === "hospital") return "hospital";
  if (t.family === "lab") return "lab";
  if (t.family === "events") return "events";
  return "general";
}

let n = 0;
const sid = (p: string) => `${p}-${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const hero = (name: string, text: string, shop: boolean): Section => ({
  id: sid("hero"), type: "hero", variant: "centered", heading: name, text,
  buttons: shop ? [{ label: "Shop online", href: "/shop" }, { label: "Contact us", href: "/contact" }] : [{ label: "Contact us", href: "/contact" }],
  image: null, mobileImage: null,
});
const about = (name: string): Section => ({ id: sid("about"), type: "about", heading: `About ${name}`, text: `Write a short introduction to ${name}: who you serve, since when, and what makes you different.`, image: null });
const contact = (form: Section["form"], heading = "Contact us"): Section => ({ id: sid("contact"), type: "contact", heading, text: "", form });
const services = (heading: string, hint: string): Section => ({ id: sid("services"), type: "services", heading, items: [{ title: "Service name", text: hint }] });

export interface Draft { settings: SiteSettings; pages: { slug: string; title: string; kind: string; sections: Section[] }[] }

export function draftFor(template: TemplateId, b: { name: string; phone: string | null; email: string | null; address: string | null }, storeOn: boolean): Draft {
  const name = b.name.trim() || "Our business";
  const shop = storeOn && TEMPLATES[template].store;
  const settings: SiteSettings = {
    name, tagline: "", logo: null, favicon: null, colors: { primary: "#0b2a6b", accent: "#1e88e5" }, font: "system",
    contact: { phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "", whatsapp: "", mapUrl: "" },
    hours: DAYS.map((day) => ({ day, open: "", close: "", closed: false })),
    social: { facebook: "", instagram: "", youtube: "", tiktok: "", x: "", linkedin: "" },
    footerText: "", seo: { title: "", description: "", image: null },
  };
  const home: Section[] = [];
  let contactForm: Section["form"] = "contact";
  switch (template) {
    case "pharmacy":
      home.push(hero(name, "Write one line about your pharmacy, e.g. the area you serve.", shop));
      home.push(about(name));
      if (shop) home.push({ id: sid("cat"), type: "categories", heading: "Shop by category" }, { id: sid("feat"), type: "featured", heading: "Featured products", limit: 8 });
      home.push(services("How to order", "Explain how customers order and, for prescription medicines, that a pharmacist checks the prescription first."));
      break;
    case "retail":
      home.push(hero(name, "Write one line about your shop.", shop));
      if (shop) home.push({ id: sid("cat"), type: "categories", heading: "Shop by category" }, { id: sid("feat"), type: "featured", heading: "Featured products", limit: 8 });
      home.push({ id: sid("cta"), type: "cta", heading: "Visit us or order online", text: "Replace with your own message.", buttons: [{ label: shop ? "Start shopping" : "Contact us", href: shop ? "/shop" : "/contact" }] });
      break;
    case "clinic":
      home.push(hero(name, "Write one line about your clinic.", false), about(name), { id: sid("doc"), type: "doctors", heading: "Our doctors" },
        services("Services", "Describe a service you offer."), { id: sid("hours"), type: "hours", heading: "Timings" });
      contactForm = "appointment";
      break;
    case "hospital":
      home.push(hero(name, "Write one line about your hospital.", false), { id: sid("dep"), type: "departments", heading: "Departments" },
        { id: sid("doc"), type: "doctors", heading: "Doctors" }, services("Facilities", "Describe a facility, e.g. emergency or radiology, only if you offer it."));
      contactForm = "appointment";
      break;
    case "lab":
      home.push(hero(name, "Write one line about your lab.", false), about(name), services("Tests and services", "Name a test or service and how to get it."), { id: sid("hours"), type: "hours", heading: "Timings" });
      break;
    case "distributor":
      home.push(hero(name, "Write one line about the companies and areas you supply.", shop), about(name));
      if (shop) home.push({ id: sid("feat"), type: "featured", heading: "Catalogue highlights", limit: 12 });
      contactForm = "quotation";
      break;
    case "restaurant":
    case "events":
      home.push(hero(name, template === "events" ? "Write one line about your venue." : "Write one line about your food.", false), about(name),
        services(template === "events" ? "Packages" : "Menu highlights", "Describe a dish or package."), { id: sid("gal"), type: "gallery", heading: "Gallery", images: [] });
      break;
    default:
      home.push(hero(name, "Write one line about your business.", false), about(name), services("Services", "Describe a service you offer."), { id: sid("gal"), type: "gallery", heading: "Gallery", images: [] });
  }
  home.push({ ...contact(contactForm, contactForm === "appointment" ? "Request an appointment" : contactForm === "quotation" ? "Request a quotation" : "Contact us") });
  return {
    settings,
    pages: [
      { slug: "home", title: "Home", kind: "home", sections: home },
      { slug: "about", title: "About", kind: "page", sections: [about(name)] },
      { slug: "contact", title: "Contact", kind: "contact", sections: [contact(contactForm), { id: sid("hours"), type: "hours", heading: "Opening hours" }] },
    ],
  };
}
