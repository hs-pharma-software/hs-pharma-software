/** On-screen notices: a message slides in at the corner instead of a browser
 * alert that freezes the page. Works from any code (components, repos,
 * helpers); the <Toaster /> at the root of the app shows them. */
export type NoticeTone = "error" | "success" | "info";
export interface Notice { id: number; message: string; tone: NoticeTone }

let notices: Notice[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The tone from the wording, so `notify("Could not save: …")` shows as an error. */
export function toneOf(message: string): NoticeTone {
  if (/^(could ?n[o']t|can[' ]?no?t|cannot|unable|failed|error|not allowed|no permission|you (do not|don't) have|wrong|invalid|enter |choose |select |add at least|please )/i.test(message.trim())) return "error";
  if (/\b(failed|error|not saved|refused|denied)\b/i.test(message)) return "error";
  if (/^(saved|done|sent|copied|created|updated|deleted|posted|uploaded|imported)\b/i.test(message.trim())) return "success";
  return "info";
}

export function notify(message: unknown, tone?: NoticeTone): void {
  const text = message instanceof Error ? message.message : String(message ?? "");
  if (!text.trim()) return;
  const t = tone ?? toneOf(text);
  // The same message twice in a row is shown once.
  if (notices.some((n) => n.message === text)) return;
  notices = [...notices.slice(-3), { id: ++seq, message: text, tone: t }];
  emit();
}

export function dismissNotice(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function subscribeNotices(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export const currentNotices = (): Notice[] => notices;
