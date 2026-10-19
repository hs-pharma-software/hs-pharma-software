"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { login, AuthError } from "@/lib/auth";
import { useAuthStore } from "@/store/authStore";

export function LoginScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        <div className="mb-5 text-center">
          <h1 className="font-serif text-2xl text-neutral-800">eSales Pharmacy</h1>
          <p className="mt-1 text-sm text-neutral-500">Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Username" required>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" variant="primary" disabled={loading} className="mt-2 justify-center">
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
