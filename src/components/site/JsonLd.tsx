/** Structured data (schema.org JSON-LD) for search engines. "<" is escaped so
 * no text can close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** The business behind MAVIN.pk, as the public site states it (no legal name or NTN). */
export const ORGANIZATION_LD = (siteUrl: string) => ({
  "@context": "https://schema.org",
  "@type": ["Organization", "LocalBusiness"],
  name: "MAVIN.pk",
  url: `${siteUrl}/`,
  logo: `${siteUrl}/mavin-header.png`,
  image: `${siteUrl}/mavin-header.png`,
  description: "POS and business software for pharmacies, shops, clinics, labs, restaurants and distributors in Pakistan.",
  telephone: "+92-316-0585858",
  email: "info@mavin.pk",
  address: { "@type": "PostalAddress", addressLocality: "Sargodha", addressRegion: "Punjab", addressCountry: "PK" },
  areaServed: { "@type": "Country", name: "Pakistan" },
  openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], opens: "09:00", closes: "18:00" }],
  contactPoint: [{ "@type": "ContactPoint", telephone: "+92-316-0585858", email: "info@mavin.pk", contactType: "customer support", areaServed: "PK", availableLanguage: ["English", "Urdu"] }],
});

export const WEBSITE_LD = (siteUrl: string) => ({ "@context": "https://schema.org", "@type": "WebSite", name: "MAVIN.pk", url: `${siteUrl}/` });
