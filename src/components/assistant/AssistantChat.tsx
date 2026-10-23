"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Send, RotateCcw } from "lucide-react";
import type { GeminiContent } from "@/lib/gemini";
import { askAssistant } from "@/lib/assistant";
import { hasAiKey } from "@/lib/gemini";
import { useIsTauri } from "@/lib/platform";

interface ChatLine {
  role: "user" | "assistant" | "error";
  text: string;
}

const SUGGESTIONS = [
  "HS code and FBR details for a rubber nipple",
  "FBR details for phenyl liquid 500 ml",
  "Is tramadol a controlled drug? Usual adult dose?",
  "Which DRAP-registered brands contain amoxicillin + clavulanic acid?",
];

/** Floating AI assistant (bottom-right) for HS codes, FBR fields and medicine questions. */
export function AssistantChat() {
  const tauriReady = useIsTauri();
  const [open, setOpen] = useState(false);
  const [keySet, setKeySet] = useState<boolean | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [transcript, setTranscript] = useState<GeminiContent[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      void hasAiKey().then(setKeySet);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setLines((l) => [...l, { role: "user", text: question }]);
    setBusy(true);
    try {
      const turn = await askAssistant(transcript, question);
      setTranscript(turn.transcript);
      setLines((l) => [...l, { role: "assistant", text: turn.reply }]);
    } catch (e) {
      setLines((l) => [...l, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setLines([]);
    setTranscript([]);
  }

  if (!tauriReady) return null;

  return (
    <div className="print:hidden">
      {open && (
        <div className="fixed bottom-20 right-5 z-[60] flex h-[560px] max-h-[calc(100vh-7rem)] w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06]">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white">
              <Sparkles size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900">AI Assistant</p>
              <p className="truncate text-[11px] text-neutral-400">HS codes · FBR details · Medicines</p>
            </div>
            {lines.length > 0 && (
              <button type="button" title="New chat" onClick={reset} className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <RotateCcw size={15} />
              </button>
            )}
            <button type="button" title="Close" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
              <X size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {keySet === false && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                Add your free Gemini API key in{" "}
                <Link href="/settings" className="font-medium underline" onClick={() => setOpen(false)}>
                  Settings &gt; AI Assistant
                </Link>{" "}
                to use the assistant.
              </p>
            )}
            {lines.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500">
                  Ask about HS codes, FBR invoice fields, products in your catalog, or medicines. Answers are checked
                  against FBR&apos;s and DRAP&apos;s lists where possible.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || keySet === false}
                    onClick={() => void send(s)}
                    className="block w-full rounded-xl bg-neutral-50 px-3 py-2 text-left text-xs text-neutral-700 ring-1 ring-black/[0.04] hover:bg-neutral-100 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {lines.map((l, i) => (
              <div key={i} className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    l.role === "user"
                      ? "bg-neutral-900 text-white"
                      : l.role === "error"
                        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                        : "bg-neutral-100 text-neutral-800"
                  }`}
                >
                  {l.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-500">Looking that up...</div>
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-neutral-100 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              disabled={keySet === false}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask a question..."
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || keySet === false}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-neutral-900 text-white disabled:opacity-40"
              title="Send (Enter)"
            >
              <Send size={15} />
            </button>
          </form>
          <p className="px-3 pb-2 text-[10px] text-neutral-400">
            AI answers can be wrong. Medicine information is general guidance for pharmacy staff, not a prescription.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="AI Assistant"
        className="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-[0_6px_20px_rgba(0,0,0,0.25)] transition hover:scale-105"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>
    </div>
  );
}
