import { invoke } from "@tauri-apps/api/core";
import { PAPERS, type PaperSize } from "./printTemplates";
import { isTauri } from "./platform";

const PX_PER_MM = 96 / 25.4;

/** Prints the current page (only `.print-area` is visible in print CSS)
 * straight to the default Windows printer, with no print dialog. Falls back
 * to the browser dialog outside the desktop app or if WebView2 can't print
 * silently. `area` is measured so thermal rolls get an exact page length. */
export async function printDirect(paper: PaperSize, area?: HTMLElement | null): Promise<void> {
  const p = PAPERS.find((x) => x.id === paper)!;
  if (!isTauri()) {
    window.print();
    return;
  }
  const heightMm =
    paper === "a4" ? 297 : paper === "a5" ? 210 : Math.ceil((area?.scrollHeight ?? 600) / PX_PER_MM) + p.marginMm * 2 + 5;
  try {
    await invoke("print_silent", { widthMm: p.widthMm, heightMm, marginMm: p.marginMm });
  } catch (e) {
    console.warn("silent print failed, falling back to the print dialog", e);
    window.print();
  }
}
