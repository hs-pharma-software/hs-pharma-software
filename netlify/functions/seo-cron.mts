/** Netlify's stand-in for the Vercel cron in vercel.json: the daily SEO run
 * at 01:00 UTC. It calls the same route with the same CRON_SECRET. */
const run = async (): Promise<Response> => {
  const base = (process.env.URL || "").replace(/\/+$/, "");
  const res = await fetch(`${base}/api/seo/run/`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  return new Response(`seo run: ${res.status}`);
};

export default run;

export const config = { schedule: "0 1 * * *" };
