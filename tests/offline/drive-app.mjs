// Drives the running MAVIN Offline window over the DevTools protocol (local
// smoke test only): set up, search, sell, sync. Screenshots to <outDir>.
//   node tests/offline/drive-app.mjs <debugPort> <outDir>
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [port, outDir] = [process.argv[2] ?? "9333", process.argv[3] ?? "."];
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith("file:"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, "base64")); console.log("shot", name); };
const set = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);

await set("#setupUser", "demo");
await set("#setupPass", "demo-pass");
await js(`document.querySelector("#setupForm").requestSubmit()`);
await sleep(4000);
console.log("after setup:", await js(`document.querySelector("#notice").textContent`));
await shot("2-pos-empty.png");

await set("#search", "panadol");
await sleep(600);
await js(`document.querySelector("#results li").click()`);
await set("#search", "syrup");
await sleep(600);
await js(`document.querySelector("#results li").click()`);
// Panadol: 5 loose tablets
await js(`(() => { const s = document.querySelector("#cart tbody tr select"); s.value = "loose"; s.dispatchEvent(new Event("change")); })()`);
await sleep(200);
await js(`(() => { const i = document.querySelector("#cart tbody tr td.num input"); i.value = "5"; i.dispatchEvent(new Event("change")); })()`);
await set("#tendered", "500");
await sleep(300);
await shot("3-bill.png");
await js(`document.querySelector("#saveBtn").click()`);
await sleep(4000);
console.log("after sale:", await js(`document.querySelector("#notice").textContent`));
console.log("error:", await js(`document.querySelector("#saleError").hidden ? "" : document.querySelector("#saleError").textContent`));
await shot("4-after-sale.png");
ws.close();
