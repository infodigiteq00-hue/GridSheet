"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Couldn't sign in — try again.");
        return;
      }
      const next = params.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div
            className="w-[30px] h-[30px] rounded-[8px] bg-[#17161a] grid p-[6px] gap-[2px]"
            style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}
          >
            <div className="bg-[#2b4bff] rounded-[1px]" />
            <div className="bg-[#ffb020] rounded-[1px]" />
            <div className="bg-[#00a6a6] rounded-[1px]" />
            <div className="bg-[#f3f1ec] rounded-[1px]" />
          </div>
          <div className="font-display font-bold text-[19px] tracking-[-0.02em] text-[#17161a]">Gridsheet</div>
        </div>

        <div className="border border-[rgba(23,22,26,0.14)] rounded-[18px] bg-[#fdfcfa] p-8">
          <div className="font-display text-[22px] font-bold tracking-[-0.02em] mb-1.5">Sign in</div>
          <p className="text-[13.5px] text-[#6b6a71] mb-6 leading-[1.5]">
            Your dashboards stay in this browser — signing in just keeps this workspace private to you.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-[#4a4952]">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="border border-[rgba(23,22,26,0.16)] rounded-[10px] px-3.5 py-3 text-sm outline-none focus:border-[#2b4bff] bg-white"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-[#4a4952]">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="border border-[rgba(23,22,26,0.16)] rounded-[10px] px-3.5 py-3 text-sm outline-none focus:border-[#2b4bff] bg-white"
              />
            </label>

            {error && (
              <div className="text-[13px] text-[#c0341c] bg-[rgba(192,52,28,0.08)] border border-[rgba(192,52,28,0.25)] rounded-[10px] px-3.5 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1.5 bg-[#17161a] text-white rounded-[11px] py-3 text-[14.5px] font-semibold cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-60 disabled:cursor-default"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="text-[12.5px] text-[#8a8990] text-center mt-5 leading-[1.6]">
          Demo credentials: <span className="font-mono-plex">demo@gridsheet.app</span> /{" "}
          <span className="font-mono-plex">gridsheet2026</span>
          <br />
          (unless <span className="font-mono-plex">AUTH_EMAIL</span>/<span className="font-mono-plex">AUTH_PASSWORD</span> are set)
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
