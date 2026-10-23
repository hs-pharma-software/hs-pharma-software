/**
 * Reads the family / full name from a TrueType / OpenType font file's
 * `name` table, to confirm an uploaded file really is Jameel Noori
 * Nastaleeq. Pure (runs under node --test).
 */
export function readFontNames(buf: ArrayBuffer): { family: string | null; full: string | null } {
  const v = new DataView(buf);
  if (buf.byteLength < 12) throw new Error("Not a font file.");
  const tag = v.getUint32(0);
  // 0x00010000 TrueType, 'OTTO' CFF, 'true' old Mac TrueType.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) throw new Error("Upload a .ttf or .otf font file.");
  const numTables = v.getUint16(4);
  let nameOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.byteLength) break;
    if (String.fromCharCode(v.getUint8(rec), v.getUint8(rec + 1), v.getUint8(rec + 2), v.getUint8(rec + 3)) === "name") {
      nameOffset = v.getUint32(rec + 8);
      break;
    }
  }
  if (nameOffset < 0) throw new Error("The font has no name table.");
  const count = v.getUint16(nameOffset + 2);
  const strings = nameOffset + v.getUint16(nameOffset + 4);
  const found: Record<number, string> = {};
  for (let i = 0; i < count; i++) {
    const r = nameOffset + 6 + i * 12;
    const platform = v.getUint16(r);
    const nameId = v.getUint16(r + 6);
    const len = v.getUint16(r + 8);
    const off = strings + v.getUint16(r + 10);
    if ((nameId !== 1 && nameId !== 4) || found[nameId]) continue;
    let s = "";
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(v.getUint16(off + j));
    } else if (platform === 1) {
      for (let j = 0; j < len; j++) s += String.fromCharCode(v.getUint8(off + j));
    }
    if (s.trim()) found[nameId] = s.trim();
  }
  return { family: found[1] ?? null, full: found[4] ?? null };
}

/** True when the font names identify Jameel Noori Nastaleeq. */
export const isJameelNoori = (n: { family: string | null; full: string | null }) =>
  /jameel\s*noori\s*nastaleeq/i.test(`${n.family ?? ""} ${n.full ?? ""}`);
