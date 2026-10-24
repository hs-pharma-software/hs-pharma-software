/** "Dr Rab Nawaz" stays as it is; "Rab Nawaz" becomes "Dr. Rab Nawaz". */
export function doctorLabel(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "Doctor not named";
  return /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`;
}
