"use client";

import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { login, AuthError } from "@/lib/auth";
import { useAuthStore } from "@/store/authStore";

export function LoginScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user, tenant } = await login(username, password);
      setSession(user, tenant);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-10"
      style={{
        background: "linear-gradient(135deg, #0f0f4a 0%, #1a1a6e 55%, #22226e 100%)",
      }}
    >
      {/* Subtle decorative circles */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-10"
          style={{ background: "#f97316" }}
        />
        <div
          className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full opacity-10"
          style={{ background: "#f97316" }}
        />
        <div
          className="absolute left-1/2 top-1/4 h-64 w-64 -translate-x-1/2 rounded-full opacity-5"
          style={{ background: "#ffffff" }}
        />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md rounded-3xl bg-white/95 px-8 py-10 shadow-2xl backdrop-blur-xl ring-1 ring-white/20">
        {/* Branding */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
            style={{ background: "linear-gradient(135deg, #1a1a6e, #2d2da0)" }}
          >
            <Image src="/logo.png" alt="BilloraX" width={40} height={40} className="object-contain" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "#1a1a6e" }}>
              Billora<span style={{ color: "#f97316" }}>X</span>
            </h1>
            <p className="mt-1 text-sm text-neutral-500">Pharmacy & Store Management</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              placeholder="Enter your username"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-[#1a1a6e] focus:bg-white focus:ring-2 focus:ring-[#1a1a6e]/20 placeholder:text-neutral-400"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 pr-11 text-sm text-neutral-800 outline-none transition focus:border-[#1a1a6e] focus:bg-white focus:ring-2 focus:ring-[#1a1a6e]/20 placeholder:text-neutral-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 transition hover:text-neutral-700"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 ring-1 ring-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-xl py-3 text-sm font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-60"
            style={{
              background: loading
                ? "#f97316cc"
                : "linear-gradient(135deg, #f97316, #ea6a00)",
              boxShadow: "0 4px 14px rgba(249,115,22,0.4)",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-neutral-400">
          Powered by <span className="font-semibold" style={{ color: "#1a1a6e" }}>Billora</span>
          {" "}— Smart Pharmacy Solutions
        </p>
      </div>
    </div>
  );
}
