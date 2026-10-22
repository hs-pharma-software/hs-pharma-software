// Controlled substances (CNSA 1997 / DRAP psychotropic & narcotic schedules)
// plus ephedrine-type precursors, matched against product name + description.
export const NARCOTIC_KEYWORDS = [
  "ALPRAZOLAM", "BROMAZEPAM", "DIAZEPAM", "LORAZEPAM", "CLONAZEPAM", "MIDAZOLAM",
  "CHLORDIAZEPOXIDE", "OXAZEPAM", "TEMAZEPAM", "NITRAZEPAM", "ZOLPIDEM", "PHENOBARBITAL",
  "TRAMADOL", "TAPENTADOL", "NALBUPHINE", "PENTAZOCINE", "BUPRENORPHINE", "MORPHINE",
  "PETHIDINE", "MEPERIDINE", "FENTANYL", "CODEINE", "METHADONE", "KETAMINE", "OXYCODONE",
  "HYDROCODONE", "DEXTROPROPOXYPHENE", "PSEUDOEPHEDRINE", "EPHEDRINE",
];

export function detectNarcotic(...texts: (string | null | undefined)[]): string | null {
  const t = texts.filter(Boolean).join(" ").toUpperCase();
  return NARCOTIC_KEYWORDS.find((k) => t.includes(k)) ?? null;
}
