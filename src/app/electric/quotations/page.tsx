"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EsGuard, PageTitle } from "@/components/electric/ui";
import { DocList } from "@/components/electric/DocList";
import { useT } from "@/lib/i18n";

export default function QuotationsPage() {
  const t = useT();
  return (
    <EsGuard>
      <PageTitle
        title={t("nav.quotations")}
        actions={
          <Link href="/electric/quotations/new">
            <Button variant="primary">
              <Plus size={14} /> {t("s.newQuotation")}
            </Button>
          </Link>
        }
      />
      <DocList type="quotation" />
    </EsGuard>
  );
}
