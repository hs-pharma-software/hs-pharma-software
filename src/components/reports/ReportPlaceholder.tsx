import { PageHeader } from "@/components/ui/PageHeader";

/** Every report screen in the reference app shares the same shape: a small
 * parameter form (Type / Duration / Base Unit dropdowns) + a Report button
 * that renders a computed table. The underlying data (invoices, purchases,
 * expenses, etc.) isn't populated by any screen yet, so these are stubbed
 * until the Invoices/Purchase modules exist to report on. */
export function ReportPlaceholder({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <p className="mb-3 text-xs text-neutral-500">
          Parameter form (Type / Duration / Base Unit) â€” wiring pending until source data
          (Invoices, Purchases, Expenses) is entered.
        </p>
        <div className="flex flex-col gap-2 opacity-50">
          <div className="h-8 rounded-md border border-neutral-200 bg-neutral-50" />
          <div className="h-8 rounded-md border border-neutral-200 bg-neutral-50" />
        </div>
      </div>
    </div>
  );
}

