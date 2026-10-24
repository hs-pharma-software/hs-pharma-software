"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle, FileText, Package } from "lucide-react";
import { PrescriptionViewModal } from "./PrescriptionViewModal";
import { doctorLabel } from "@/lib/doctorName";
import { useAppStore } from "@/store/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import {
  rxNotificationsRepo,
  getPendingRxNotifications,
  acknowledgeRxNotification,
  markRxNotificationRead,
  type PharmacyRxNotification,
} from "@/lib/repo/clinic";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  acknowledged: "bg-blue-100 text-blue-700",
  dispensed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
};

export default function RxInboxPage() {
  const router = useRouter();
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const setPendingAction = useAppStore((s) => s.setPendingAction);
  const [notifications, setNotifications] = useState<PharmacyRxNotification[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [viewing, setViewing] = useState<string | null>(null);
  const pharmacyName = useAuthStore((s) => s.currentTenant?.name ?? null);
  const tauriReady = useIsTauri();

  async function reload() {
    if (!isTauri()) return;
    if (filter === "pending") {
      setNotifications(await getPendingRxNotifications(50));
    } else {
      setNotifications(await rxNotificationsRepo.list({ orderBy: "created_at DESC" }));
    }
  }

  useEffect(() => { void reload(); }, [tenantId, filter]);

  async function handleAcknowledge(id: string) {
    if (!isTauri()) return;
    await acknowledgeRxNotification(id);
    void reload();
  }

  async function convertToInvoice(prescriptionId: string, notificationId: string) {
    if (!isTauri()) return;
    await markRxNotificationRead(notificationId);
    setPendingAction("new-invoice-from-rx", prescriptionId);
    router.push("/invoices");
  }

  async function showPrescription(notif: PharmacyRxNotification) {
    setViewing(notif.id);
    if (!notif.read_at) {
      await markRxNotificationRead(notif.id).catch(() => undefined);
      void reload();
    }
  }

  return (
    <div>
      <PageHeader
        title="Prescription Inbox"
        actions={
          <>
            <div className="flex rounded-lg overflow-hidden border border-neutral-200 text-sm">
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`px-3 py-1.5 ${filter === "pending" ? "bg-blue-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 ${filter === "all" ? "bg-blue-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                All
              </button>
            </div>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-10 text-center">
          <Bell className="mx-auto mb-3 text-neutral-300" size={32} />
          <p className="text-sm text-neutral-500">No {filter === "pending" ? "pending " : ""}prescriptions in the inbox.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-4 ${!notif.read_at ? "border-l-4 border-amber-400" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[notif.status] ?? ""}`}>
                      {notif.status}
                    </span>
                    <span className="text-xs text-neutral-400">{notif.rx_date}</span>
                    {!notif.read_at && <span className="text-xs bg-amber-400 text-white px-1.5 py-0.5 rounded-full font-medium">New</span>}
                  </div>
                  <p className="font-semibold text-sm text-neutral-800">{notif.patient_name ?? "Unknown Patient"}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {notif.clinic_name || "Clinic"} · {doctorLabel(notif.doctor_name)} · {notif.item_count} item{notif.item_count !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={() => void showPrescription(notif)}>
                    <FileText size={13} className="mr-1" />
                    Show Prescription
                  </Button>
                  {notif.status === "pending" && (
                    <Button variant="ghost" onClick={() => void handleAcknowledge(notif.id)}>
                      <CheckCircle size={13} className="mr-1" />
                      Acknowledge
                    </Button>
                  )}
                  {notif.status !== "dispensed" && notif.status !== "rejected" && (
                    <Button variant="primary" onClick={() => void convertToInvoice(notif.prescription_id, notif.id)}>
                      <Package size={13} className="mr-1" />
                      Create Invoice
                    </Button>
                  )}
                  {notif.invoice_id && (
                    <span className="text-xs text-green-600 font-medium">Invoice Created</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <PrescriptionViewModal
          notificationId={viewing}
          pharmacyName={pharmacyName}
          onClose={() => setViewing(null)}
          onConvert={(prescriptionId, notificationId) => {
            setViewing(null);
            void convertToInvoice(prescriptionId, notificationId);
          }}
        />
      )}
    </div>
  );
}
