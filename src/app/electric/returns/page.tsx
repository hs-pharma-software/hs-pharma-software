"use client";

import { useState } from "react";
import { EsGuard, Note, PageTitle } from "@/components/electric/ui";
import { DocList } from "@/components/electric/DocList";
import { useT } from "@/lib/i18n";

export default function ReturnsPage() {
  const t = useT();
  const [type, setType] = useState<"sale_return" | "purchase_return">("sale_return");
  return (
    <EsGuard>
      <PageTitle title={t("nav.returns")} />
      <div className="mb-3 flex gap-1">
        {(["sale_return", "purchase_return"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setType(k)} className={`rounded-full px-4 py-1.5 text-sm ${type === k ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {t(`mv.${k}`)}
          </button>
        ))}
      </div>
      <div className="mb-3">
        <Note>{t("r.returnHint")}</Note>
      </div>
      <DocList key={type} type={type} />
    </EsGuard>
  );
}
