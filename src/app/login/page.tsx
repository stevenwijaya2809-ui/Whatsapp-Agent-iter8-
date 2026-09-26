"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || signingIn) return;

    setSigningIn(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Sign in failed (${res.status})`);

      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") ? next : "/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSigningIn(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/[0.06] bg-[#141414] p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm leading-tight font-semibold text-white">WhatsApp AI Agent</h1>
            <p className="mt-0.5 text-xs leading-tight text-white/40">Sign in to view conversations</p>
          </div>
        </div>

        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-white/60">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.06] px-3 py-2 text-sm text-white/90 placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
          placeholder="Dashboard password"
        />

        {error && (
          <p role="alert" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={signingIn || !password}
          className="mt-5 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
