import { PageHeader } from "@/components/ui/PageHeader";

const VIEW_SHORTCUTS = [
  ["ALT + I", "Invoice Details"],
  ["ALT + P", "Product Detail"],
  ["ALT + H", "Purchase Details"],
  ["ALT + M", "Memorized Invoice Detail"],
  ["ALT + S", "Stock Details"],
  ["ALT + R", "Invoice Return Details"],
  ["ALT + D", "Dashboard"],
  ["ALT + C", "Cash In / Out Details"],
  ["ALT + X", "Expenses Details"],
  ["ALT + B", "Backup"],
  ["CTRL + T", "System Calculator"],
];

const NEW_SHORTCUTS = [
  ["ALT + U", "New Purchase"],
  ["ALT + O", "New Order"],
  ["ALT + E", "New Expense"],
  ["ALT + N", "New Invoice"],
  ["ALT + Q", "Supplier Payable"],
  ["ALT + Y", "Customer Receivable"],
  ["ALT + G", "Generate Barcode"],
  ["ALT + W", "Bank Statement"],
  ["ALT + A", "New Audit"],
];

export default function ShortcutsPage() {
  return (
    <div>
      <PageHeader title="System Shortcuts" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ShortcutTable heading="To Open View Forms" rows={VIEW_SHORTCUTS} />
        <ShortcutTable heading="To Open New Forms" rows={NEW_SHORTCUTS} />
      </div>
    </div>
  );
}

function ShortcutTable({ heading, rows }: { heading: string; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="bg-neutral-100 px-4 py-2 text-center font-serif text-neutral-700">{heading}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={keys} className="border-b border-neutral-100 last:border-0">
              <td className="w-32 px-4 py-2 font-mono text-neutral-500">{keys}</td>
              <td className="px-4 py-2 text-neutral-800">{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
