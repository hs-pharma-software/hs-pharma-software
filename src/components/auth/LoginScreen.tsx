"use client";

import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { login, AuthError } from "@/lib/auth";
import { ForgotPassword } from "./ForgotPassword";
import { useAuthStore } from "@/store/authStore";

/** `notice`: why the accounts could not be checked (e.g. no connection). */
export function LoginScreen({ notice = null }: { notice?: string | null } = {}) {
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(notice ? `Could not reach the server: ${notice}` : null);
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
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
        background: "linear-gradient(135deg, #071640 0%, #0b2a6b 55%, #1565c0 100%)",
      }}
    >
      {/* Subtle decorative circles */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-10"
          style={{ background: "#1e88e5" }}
        />
        <div
          className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full opacity-10"
          style={{ background: "#22c55e" }}
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
          <h1 className="sr-only">MAVIN.pk</h1>
          <Image src="/mavin-logo.png" alt="MAVIN.pk - Smarter Solutions. Brighter Future." width={1340} height={330} priority className="h-auto w-full max-w-[320px] object-contain" />
        </div>

        {forgot ? (
          <ForgotPassword
            onDone={(username) => { setForgot(false); setUsername(username); setPassword(""); setError(null); setInfo("Password changed. Sign in with your new password."); }}
            onCancel={() => setForgot(false)}
          />
        ) : (
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
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-[#1e88e5] focus:bg-white focus:ring-2 focus:ring-[#1e88e5]/20 placeholder:text-neutral-400"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Password
              </label>
              <button type="button" onClick={() => { setForgot(true); setError(null); setInfo(null); }} className="text-xs font-medium text-[#1565c0] hover:underline">
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 pr-11 text-sm text-neutral-800 outline-none transition focus:border-[#1e88e5] focus:bg-white focus:ring-2 focus:ring-[#1e88e5]/20 placeholder:text-neutral-400"
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

          {info && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
              {info}
            </div>
          )}

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
                ? "#1e88e5cc"
                : "linear-gradient(135deg, #1e88e5, #0b4fb3)",
              boxShadow: "0 4px 14px rgba(30,136,229,0.4)",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        )}

        {/* Footer */}
        <p className="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs text-neutral-400">
          Powered by
          <Image src="/mavin-header.png" alt="MAVIN.pk" width={1405} height={361} className="inline-block h-5 w-auto object-contain" />
          <span>— Smarter Solutions. Brighter Future.</span>
        </p>
      </div>
    </div>
  );
}
