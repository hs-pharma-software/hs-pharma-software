import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import Link from "next/link";
import { appLoginUrl } from "@/config/site";
import { PageIntro, Section, at, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = withSeoMeta("/help", {
  title: "Help",
  description: "Help for existing MAVIN.pk customers.",
  alternates: { canonical: "/help" },
});

const FAQ = [
  ["I can't sign in on a new computer.", "The first sign-in on each computer needs internet. After that, the desktop app also signs in offline."],
  ["The desktop app shows changes as pending.", "They are saved on the computer and sync when the connection returns. Keep the app open while online."],
  ["A staff member can't refund or export.", "These actions are off for staff until the owner allows them in Manage Logins."],
  ["FBR rejected an invoice.", "Open the invoice to see FBR's message. Most rejections are a missing HS code, sale type or unit on a product."],
];

export default async function HelpPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Help" title="Help for existing customers.">
        <a href={appLoginUrl(base)} className="font-medium text-[#1565c0] hover:underline">Sign in to the app</a>, or find a quick answer below.
      </PageIntro>
      <Section title="Common questions">
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {FAQ.map(([q, a]) => (
            <details key={q} className="px-5 py-4">
              <summary className="cursor-pointer list-none font-medium text-[#0b2a6b] [&::-webkit-details-marker]:hidden">{q}</summary>
              <p className="mt-2 text-sm text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </Section>
      <Section>
        <p className="text-sm text-slate-600">Still stuck? <Link href={at(base, "/contact")} className="font-medium text-[#1565c0] hover:underline">Contact us</Link>.</p>
      </Section>
    </>
  );
}
