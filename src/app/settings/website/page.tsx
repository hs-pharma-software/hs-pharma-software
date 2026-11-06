"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { SERVER_DB } from "@/lib/serverMode";
import { WebsiteManager } from "@/components/web/manage/WebsiteManager";

/** Settings > Website: the business's website, online store, orders and domains. */
export default function WebsiteSettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Website" />
      {SERVER_DB ? <WebsiteManager /> : <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">The website is managed in the web version of MAVIN.pk.</p>}
    </div>
  );
}
