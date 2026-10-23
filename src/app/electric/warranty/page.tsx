"use client";

import { useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import { warrantyActive } from "@/lib/electric/engine";
import type { EsClaim } from "@/lib/electric/store";
import { Err, EsGuard, Id, Note, PageTitle, Txt, todayYmd, useLoad } from "@/components/electric/ui";

const CLAIM_STATUSES: EsClaim["status"][] = ["open", "sent_to_supplier", "repaired", "replaced", "rejected", "closed"];

export default function WarrantyPage() {
  return (
    <EsGuard>
      <Warranty />
    </EsGuard>
  );
}

function Warranty() {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof electric.lookupSerial>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimFor, setClaimFor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const claims = useLoad(() => electric.listClaims(status || undefined), [status]);
  const today = todayYmd();

  const lookup = async () => {
    setError(null);
    try {
      setHits(await electric.lookupSerial(q));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle title={t("w.title")} />
      <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
        <p className="mb-2 text-sm font-semibold">{t("w.lookup")}</p>
        <div className="flex gap-2">
          <Input dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void lookup()} placeholder={t("w.serial")} />
          <Button variant="primary" onClick={() => void lookup()}>
            <Search size={14} /> {t("c.search")}
          </Button>
        </div>
        <Err error={error} />
        {hits && !hits.length && <p className="mt-3 text-sm text-neutral-500">{t("c.empty")}</p>}
        {hits?.map((s) => {
          const mfr = warrantyActive(s.warranty_end, today);
          const shop = warrantyActive(s.seller_warranty_end, today);
          return (
            <div key={s.id} className="mt-3 grid gap-2 rounded-lg border border-neutral-200 p-3 text-sm md:grid-cols-3">
              <div>
                <p className="text-xs text-neutral-500">{t("w.serial")}</p>
                <p className="font-semibold"><Id>{s.serial}</Id></p>
                <p className="text-xs">{t(`sts.${s.status}`)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">{t("w.product")}</p>
                <p><Txt>{s.product_name}</Txt></p>
                <p className="text-xs text-neutral-500"><Id>{s.sku}</Id> {s.model && <>· <Id>{s.model}</Id></>}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">{t("w.customer")}</p>
                <p><Txt>{s.customer_name}</Txt></p>
                <p className={`text-xs ${mfr ? "text-emerald-700" : "text-rose-600"}`}>{t("w.mfrEnd")}: <Id>{s.warranty_end ?? "—"}</Id></p>
                <p className={`text-xs ${shop ? "text-emerald-700" : "text-rose-600"}`}>{t("w.shopEnd")}: <Id>{s.seller_warranty_end ?? "—"}</Id></p>
              </div>
              {s.status === "sold" && (
                <div className="md:col-span-3">
                  {!mfr && !shop && <Note tone="amber">{t("w.expired")}</Note>}
                  <Button className="mt-2" onClick={() => setClaimFor(s.id)}>
                    <ShieldCheck size={14} /> {t("w.openClaim")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl bg-white ring-1 ring-black/5">
        <div className="flex items-center justify-between p-3">
          <p className="text-sm font-semibold">{t("w.claims")}</p>
          <Select className="!w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("c.all")}</option>
            {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{t(`cl.${s}`)}</option>)}
          </Select>
        </div>
        <Err error={claims.error} />
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("c.date")}</th>
              <th className="px-3 py-2 text-start">{t("w.serial")}</th>
              <th className="px-3 py-2 text-start">{t("w.product")}</th>
              <th className="px-3 py-2 text-start">{t("w.customer")}</th>
              <th className="px-3 py-2 text-start">{t("w.issue")}</th>
              <th className="px-3 py-2 text-start">{t("c.status")}</th>
            </tr>
          </thead>
          <tbody>
            {(claims.data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-neutral-100 align-top">
                <td className="px-3 py-2 text-xs"><Id>{c.opened_at}</Id></td>
                <td className="px-3 py-2"><Id>{c.serial}</Id></td>
                <td className="px-3 py-2"><Txt>{c.product_name}</Txt></td>
                <td className="px-3 py-2"><Txt>{c.customer_name}</Txt></td>
                <td className="px-3 py-2 text-xs">
                  <Txt>{c.issue}</Txt>
                  {c.resolution && <div className="text-neutral-500">{t("w.resolution")}: <Txt>{c.resolution}</Txt></div>}
                </td>
                <td className="px-3 py-2">
                  <Select
                    className="!w-44"
                    value={c.status}
                    onChange={async (e) => {
                      const next = e.target.value as EsClaim["status"];
                      const resolution = next === "open" || next === "sent_to_supplier" ? undefined : prompt(t("w.resolution"), c.resolution ?? "") ?? undefined;
                      try {
                        await electric.updateClaim(c.id, next, resolution);
                        void claims.reload();
                      } catch (err) {
                        setError(errorText(err));
                      }
                    }}
                  >
                    {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{t(`cl.${s}`)}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
            {!claims.data?.length && <tr><td colSpan={6} className="py-8 text-center text-neutral-400">{claims.loading ? t("c.loading") : t("c.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {claimFor && <ClaimModal serialId={claimFor} onClose={() => setClaimFor(null)} onDone={() => { setClaimFor(null); void claims.reload(); }} />}
    </div>
  );
}

function ClaimModal({ serialId, onClose, onDone }: { serialId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [issue, setIssue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("w.openClaim")} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <Field label={t("w.issue")} required>
          <Input autoFocus dir="auto" value={issue} onChange={(e) => setIssue(e.target.value)} />
        </Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await electric.openClaim({ serialId, issue });
                onDone();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {t("c.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
