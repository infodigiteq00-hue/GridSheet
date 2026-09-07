"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { selectActiveDataset, useAppStore } from "@/lib/store";

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/history", label: "History" },
];

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const rowCount = useAppStore((s) => selectActiveDataset(s)?.rows.length ?? 0);
  const sheetCount = useAppStore((s) => s.datasets.length);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  async function logOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  if (pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-40 flex items-center gap-7 px-6 h-[62px] bg-[#f3f1ec]/[0.78] backdrop-blur-xl backdrop-saturate-150 border-b border-[rgba(23,22,26,0.09)]">
      <Link href="/" className="flex items-center gap-2.5 shrink-0">
        <div
          className="w-[26px] h-[26px] rounded-[7px] bg-[#17161a] grid p-[5px] gap-[2px]"
          style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}
        >
          <div className="bg-[#2b4bff] rounded-[1px]" />
          <div className="bg-[#ffb020] rounded-[1px]" />
          <div className="bg-[#00a6a6] rounded-[1px]" />
          <div className="bg-[#f3f1ec] rounded-[1px]" />
        </div>
        <div className="font-display font-bold text-[17px] tracking-[-0.02em] text-[#17161a]">Gridsheet</div>
      </Link>

      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="px-[13px] py-[7px] rounded-lg text-[13.5px] tracking-[-0.01em] transition-colors"
              style={{
                background: active ? "#17161a" : "transparent",
                color: active ? "#f8f7f4" : "#4a4952",
                fontWeight: active ? 600 : 500,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "rgba(23,22,26,0.06)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 text-[12.5px] text-[#6b6a71]">
        <span className="font-mono-plex">
          {hasHydrated ? `${sheetCount > 1 ? `${sheetCount} sheets · ` : ""}${rowCount} rows` : "\u00A0"}
        </span>
        <div className="w-px h-[18px] bg-[rgba(23,22,26,0.12)]" />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-pressed={menuOpen}
            className="w-[27px] h-[27px] rounded-full bg-[#17161a] text-[#f3f1ec] grid place-items-center text-[11.5px] font-semibold cursor-pointer"
          >
            U
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-[35px] z-50 min-w-[160px] rounded-[11px] border border-[rgba(23,22,26,0.12)] bg-[#fdfcfa] shadow-[0_8px_24px_rgba(23,22,26,0.16)] p-1.5">
              <button
                type="button"
                onClick={logOut}
                disabled={signingOut}
                className="w-full text-left px-3 py-2 rounded-[8px] text-[13px] font-medium text-[#c0341c] cursor-pointer hover:bg-[rgba(192,52,28,0.08)] disabled:opacity-60"
              >
                {signingOut ? "Signing out…" : "Log out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
