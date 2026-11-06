/** Super Admin > SEO (src/server/seo). Super Admin only. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as seo from "@/server/seo/admin";
import * as studio from "@/server/seo/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// "Run now" waits for the job (a first Search Console import can take a while).
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (caller.role !== "super_admin") throw new HttpError(403, "Only the platform owner can use the SEO Manager.");
    const sql = sqlForServer();
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = `admin:${caller.userId}`;
    const id = typeof b.id === "string" ? b.id : "";
    let result: unknown;
    switch (b.action) {
      case "overview": result = await seo.overview(sql); break;
      case "dashboard": result = await seo.searchDashboard(sql); break;
      case "jobs": result = await seo.listJobs(sql); break;
      case "updateJob": result = await seo.updateJob(sql, actor, id, { enabled: b.enabled, cadence: b.cadence }); break;
      case "runNow": result = await seo.runNow(sql, actor, id); break;
      case "runs": result = await seo.listRuns(sql, b); break;
      case "activity": result = await seo.listActivity(sql, b); break;
      case "settings": result = await seo.getSettings(sql); break;
      case "killSwitch": result = await seo.setKillSwitch(sql, actor, Boolean(b.on), b.reason); break;
      case "keywords": result = await seo.listKeywords(sql); break;
      case "addKeyword": result = await seo.addKeyword(sql, actor, b.keyword, b.target); break;
      case "ignoreKeyword": result = await seo.setKeywordIgnored(sql, actor, id, Boolean(b.ignored)); break;
      case "autocomplete": result = await seo.setAutocomplete(sql, actor, Boolean(b.on)); break;
      case "drafts": result = await studio.listDrafts(sql); break;
      case "draft": result = await studio.getDraft(sql, id); break;
      case "createDraft": result = await studio.createDraft(sql, actor, b.keyword, b.path); break;
      case "updateDraft": result = await studio.updateDraft(sql, actor, id, { title: b.title, description: b.description, markdown: b.markdown }); break;
      case "decideDraft": result = await studio.decideDraft(sql, actor, id, b.decision, b.note); break;
      case "openPullRequest": result = await studio.openDraftPullRequest(sql, actor, id); break;
      case "refreshPullRequests": result = await studio.refreshPullRequests(sql, actor); break;
      case "decide": result = await seo.decideRecommendation(sql, actor, id, b.status, b.note); break;
      case "list": {
        const table = b.table;
        if (table !== "keywords" && table !== "findings" && table !== "recommendations" && table !== "drafts" && table !== "reports") throw new HttpError(400, "Unknown list.");
        result = await seo.listTable(sql, table);
        break;
      }
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
