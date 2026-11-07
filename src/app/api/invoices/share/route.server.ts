/** Invoice PDF and WhatsApp sharing (src/server/invoicePdf.ts).
 *  - action "pdf":  the invoice as a PDF file. purpose "download" needs the PDF
 *    permission; "share" (to attach it in WhatsApp) needs the WhatsApp permission.
 *  - action "whatsapp": checks the WhatsApp permission, logs the hand-off and
 *    returns the short message and the customer's saved phone. Nothing is sent. */
import { callerOf, clientIp, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { auditShare, authorizeInvoice, buildInvoicePdf, pdfFileName, shareMessage } from "@/server/invoicePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const invoiceId = typeof b.invoiceId === "string" ? b.invoiceId : "";
    const branch = req.headers.get("x-branch");
    const ip = clientIp(req);
    if (b.action === "pdf") {
      const share = b.purpose === "share";
      const inv = await authorizeInvoice(sql, caller, invoiceId, share ? "whatsapp" : "pdf", branch);
      const bytes = await buildInvoicePdf(sql, inv, new URL(req.url).origin).catch((e) => {
        if (e instanceof HttpError) throw e;
        throw new HttpError(500, "The PDF could not be made. Try again.");
      });
      await auditShare(sql, caller, inv, share ? "invoice.pdf.share" : "invoice.pdf.download", ip);
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFileName(inv)}"`,
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (b.action === "whatsapp") {
      const inv = await authorizeInvoice(sql, caller, invoiceId, "whatsapp", branch);
      if (b.log === "open") await auditShare(sql, caller, inv, `invoice.whatsapp.${b.channel === "share-sheet" ? "share" : "open"}`, ip);
      return Response.json({ result: { message: shareMessage(inv), phone: inv.customerPhone, invoiceNo: inv.no, fileName: pdfFileName(inv) } });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return jsonError(e);
  }
}
