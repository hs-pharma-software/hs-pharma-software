const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..');
function edit(file, fn) { const p = path.join(root, file); const old = fs.readFileSync(p, 'utf8'); const next = fn(old); if (next === old) throw Error(file); fs.writeFileSync(p, next); }
function sub(s,a,b) { if (!s.includes(a)) throw Error(a); return s.replace(a,b); }
edit('src/server/offline/service.ts', s => sub(s, 'where = where.replace(/ AND deleted_at IS NULL/g, "");', 'where = where.replace(/ AND deleted_at IS NULL/g, "").replace(/^deleted_at IS NULL AND /, "");'));
edit('desktop/src/main.ts', s => {
  s = sub(s, 'let lastHistory = 0;', 'let lastHistory = 0;\nlet mirrorFailures = 0;\nlet mirrorRetryAt = 0;');
  s = sub(s, 'if (r && !r.error && mirror && due) {', 'if (mirror && due && (force || Date.now() >= mirrorRetryAt)) {');
  s = sub(s, '          lastMirror = Date.now();', '          lastMirror = Date.now();\n          mirrorFailures = 0;\n          mirrorRetryAt = 0;');
  s = sub(s, '        } catch (e) { console.error("[mirror] refresh", e instanceof Error ? e.message : e); }', '        } catch (e) {\n          mirrorRetryAt = Date.now() + Math.min(3_600_000, MIRROR_EVERY_MS * 2 ** Math.min(mirrorFailures++, 4));\n          console.error("[mirror] refresh", e instanceof Error ? e.message : e);\n          return;\n        }');
  s = sub(s, 'if (r && !r.error && mirror && (due || r.pushed > 0 || Date.now() - lastHistory > MIRROR_EVERY_MS)) {', 'if (mirror && (force || Date.now() >= mirrorRetryAt) && (due || r.pushed > 0 || Date.now() - lastHistory > MIRROR_EVERY_MS)) {');
  return sub(s, '        } catch (e) { console.error("[mirror] history", e instanceof Error ? e.message : e); }', '        } catch (e) {\n          mirrorRetryAt = Date.now() + Math.min(3_600_000, MIRROR_EVERY_MS * 2 ** Math.min(mirrorFailures++, 4));\n          console.error("[mirror] history", e instanceof Error ? e.message : e);\n        }');
});
edit('src/components/sync/SyncProvider.tsx', s => {
  s = sub(s, '  const runningRef = useRef(false);', '  const runningRef = useRef(false);\n  const failuresRef = useRef(0);\n  const retryAtRef = useRef(0);');
  s = sub(s, '    if (runningRef.current) return;', '    if (runningRef.current || Date.now() < retryAtRef.current) return;');
  s = sub(s, '      await syncNow();', '      await syncNow();\n      failuresRef.current = 0;\n      retryAtRef.current = 0;');
  return sub(s, '      failed = true;', '      failed = true;\n      retryAtRef.current = Date.now() + Math.min(3_600_000, SYNC_INTERVAL_MS * 2 ** Math.min(failuresRef.current++, 6));');
});
