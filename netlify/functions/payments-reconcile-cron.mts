/** Netlify's stand-in for the Vercel cron in vercel.json: payment
 * reconciliation at 02:30 UTC, same route, same CRON_SECRET. */
const run = async (): Promise<Response> => {
  const base = (process.env.URL || "").replace(/\/+$/, "");
  const res = await fetch(`${base}/api/payments/reconcile/`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  return new Response(`payments reconcile: ${res.status}`);
};

export default run;

export const config = { schedule: "30 2 * * *" };
