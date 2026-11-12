// Drives a MAVIN window (desktop app or the web app in a plain window) over
// the DevTools protocol, for the demo comparison. Steps run in order:
//   node drive-pos.mjs <port> <outDir> login | openpos | add:<term> | qty:<n> | paid:<n> | save | shot:<name> | state | wait:<ms> | goto:<path>
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [port, outDir, ...steps] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, mods = 0, code = k) => {
  const vk = { Enter: 13, n: 78, s: 83 }[k];
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code.length === 1 ? `Key${code.toUpperCase()}` : code, modifiers: mods, windowsVirtualKeyCode: vk });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code.length === 1 ? `Key${code.toUpperCase()}` : code, modifiers: mods, windowsVirtualKeyCode: vk });
};
const setInput = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event("input", { bubbles: true })); e.focus(); return true; })()`);

for (const step of steps) {
  const [name, arg] = [step.split(":")[0], step.split(":").slice(1).join(":")];
  if (name === "login") {
    await setInput('input[placeholder="Enter your username"]', "demo");
    await setInput('input[placeholder="Enter your password"]', "demo-pass");
    await js(`document.querySelector('input[placeholder="Enter your password"]').form.requestSubmit()`);
    await sleep(5000);
  } else if (name === "pill") {
    // Opens (or closes) the header's Online/Offline panel.
    await js(`[...document.querySelectorAll("header button")].find((b) => /Online|Offline/.test(b.innerText))?.click()`);
    await sleep(800);
  } else if (name === "provision") {
    // The owner sets this computer up for offline sales from the open panel.
    await setInput('header input[type="password"]', "demo-pass");
    await js(`document.querySelector('header input[type="password"]')?.form?.requestSubmit()`);
    await sleep(15000);
    console.log("panel:", await js(`document.querySelector("header .w-72")?.innerText?.replace(/\\s+/g, " ") ?? null`));
  } else if (name === "syncnow") {
    await js(`[...document.querySelectorAll("header button")].find((b) => /Sync now/.test(b.innerText))?.click()`);
    await sleep(8000);
    console.log("panel:", await js(`document.querySelector("header .w-72")?.innerText?.replace(/\\s+/g, " ") ?? null`));
  } else if (name === "press") {
    // A real key press (e.g. press:Enter, press:F8) on whatever has the cursor.
    const vk = arg === "Enter" ? 13 : /^F\d+$/.test(arg) ? 111 + Number(arg.slice(1)) : 0;
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: arg, code: arg, windowsVirtualKeyCode: vk });
    if (arg === "Enter") await cdp("Input.dispatchKeyEvent", { type: "char", key: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: arg, code: arg, windowsVirtualKeyCode: vk });
    await sleep(400);
  } else if (name === "focused") {
    // Which field has the cursor: its label, or its column in an item line.
    console.log(`focused (${arg}):`, await js(`(() => { const e = document.activeElement; if (!e || e === document.body) return "nothing";
      const label = e.closest("label")?.querySelector("span")?.textContent?.trim();
      const td = e.closest("td"); const th = td ? td.closest("table")?.querySelectorAll("thead th")[td.cellIndex]?.textContent?.trim() : null;
      return label ? "field: " + label : th ? "line column: " + th : (e.getAttribute("placeholder") ? "box: " + e.getAttribute("placeholder") : e.tagName); })()`));
  } else if (name === "load") {
    // A full page load of an app path (the sign-in is kept).
    await js(`location.assign(${JSON.stringify(arg)})`);
    await sleep(6000);
  } else if (name === "goto") {
    await js(`(() => { history.pushState(null, "", ${JSON.stringify(arg)}); dispatchEvent(new PopStateEvent("popstate")); })()`);
    await sleep(2500);
  } else if (name === "openpos") {
    await key("n", 2);
    await sleep(2500);
  } else if (name === "add") {
    await setInput('input[placeholder="Type to search..."]', arg);
    await sleep(1500);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
    await key("Enter", 0, "Enter");
    await sleep(1500);
  } else if (name === "paid") {
    await js(`(() => { const f = [...document.querySelectorAll("label")].find((l) => /^\\s*\\*?\\s*Paid/.test(l.textContent ?? "")); const e = f?.querySelector("input"); if (!e) return; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(e, ${JSON.stringify(arg)}); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(500);
  } else if (name === "save") {
    await js(`document.querySelector('button[type="submit"][title*="Ctrl+S"]')?.click()`);
    await sleep(3500);
  } else if (name === "shot") {
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${arg}.png`), Buffer.from(r.result.data, "base64"));
    console.log(`shot ${arg}`);
  } else if (name === "wait") {
    await sleep(Number(arg));
  } else if (name === "state") {
    console.log(JSON.stringify(await js(`(() => ({
      url: location.href,
      pill: [...document.querySelectorAll("header button")].map((b) => b.innerText.replace(/\\s+/g, " ").trim()).filter((t) => /Online|Offline/.test(t))[0] ?? null,
      lines: [...document.querySelectorAll("form table tbody tr")].map((r) => r.innerText.replace(/\\s+/g, " ").trim()).filter((t) => t && !/No content/.test(t)),
      banner: document.querySelector('form p[role="status"]')?.innerText ?? null,
      error: [...document.querySelectorAll("form p")].map((p) => p.innerText).find((t) => /rose|error/i.test("") || /needs|cash only|Not enough|dropped|could not/i.test(t)) ?? null,
      notice: document.querySelector('div[role="status"]')?.innerText?.replace(/\\s+/g, " ") ?? null,
    }))()`)));
  }
}
ws.close();
