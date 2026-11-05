import { can, NO_PERMISSION_MESSAGE } from "./actionPermissions";

/** Whether this login may export data; tells the user when not. */
export function mayExport(): boolean {
  if (can("data.export")) return true;
  if (typeof window !== "undefined") window.alert(NO_PERMISSION_MESSAGE);
  return false;
}

function cell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports business data: needs the Export permission (sample files use downloadCsv). */
export function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  if (!mayExport()) return;
  downloadCsv(filename, buildCsv(headers, rows));
}
