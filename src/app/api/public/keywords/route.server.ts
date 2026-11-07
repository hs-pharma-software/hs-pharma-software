/** "Popular searches" for the public website's home page (src/components/site/KeywordMarquee). */
import { sqlForServer } from "@/server/subSupersApi";
import { popularSearches } from "@/server/seo/popular";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const items = await popularSearches(sqlForServer()).catch(() => []);
  return Response.json({ items }, { headers: { "Cache-Control": "public, max-age=600, s-maxage=900" } });
}
