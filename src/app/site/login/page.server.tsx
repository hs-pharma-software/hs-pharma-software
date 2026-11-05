import type { Metadata } from "next";
import { appLoginUrl } from "@/config/site";
import { PageIntro, Section, siteBase } from "@/components/site/chrome";

export const metadata: Metadata = {
  title: "Client Login",
  alternates: { canonical: "/login" },
};

/** The customer app's sign-in lives in the app (app.mavin.pk). */
export default async function LoginPage() {
  const base = await siteBase();
  return (
    <>
      <PageIntro eyebrow="Client Login" title="Sign in to MAVIN.pk.">
        Existing customers sign in to the app. On Windows you can also use the desktop app.
      </PageIntro>
      <Section>
        <a href={appLoginUrl(base)} className="inline-flex rounded-lg bg-[#0b2a6b] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0d3a8f]">
          Go to the app sign-in
        </a>
      </Section>
    </>
  );
}
