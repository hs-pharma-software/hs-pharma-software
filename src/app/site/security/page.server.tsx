import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { PageIntro, Section } from "@/components/site/chrome";
import { LegalDraftNote } from "@/components/site/legal";

export const metadata: Metadata = withSeoMeta("/security", { title: "Security", alternates: { canonical: "/security" } });

/** Only practices the code implements today. No certifications, uptime or guarantees. */
const PRACTICES = [
  ["Separate data per business", "The server keeps every database request inside the signed-in business's own records. Pharmacies share only the common medicine catalogue, not stock, prices or sales."],
  ["Sign-in and sessions", "Passwords are checked on the server and stored only as salted hashes. Web sessions use a cookie scripts cannot read and end after 12 hours."],
  ["Staff permissions", "Each staff login sees only the sections it is given. Refunds, exports, backup restore, FBR submission and financial closing are off for staff until the owner allows them."],
  ["Change history", "Changes made through the web version are recorded with the user, time and connection."],
  ["Offline copies", "The Windows desktop app keeps the business's own data on that computer for offline billing. Protect the computer with a Windows password."],
];

export default function SecurityPage() {
  return (
    <>
      <PageIntro eyebrow="Legal" title="Security">
        How MAVIN.pk protects business data.
      </PageIntro>
      <Section>
        <LegalDraftNote />
        <ul className="grid max-w-4xl gap-4 md:grid-cols-2">
          {PRACTICES.map(([t, d]) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
              <p className="font-semibold text-[#0b2a6b]">{t}</p>
              <p className="mt-1.5 text-slate-600">{d}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-sm text-slate-600">
          Backups and restore testing: a full copy of the database is taken before every change to its structure. To report a security issue:{" "}
          <a href="mailto:security@mavin.pk" className="font-medium hover:underline">security@mavin.pk</a>.
        </p>
      </Section>
    </>
  );
}
