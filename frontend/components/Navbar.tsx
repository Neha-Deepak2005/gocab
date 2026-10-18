"use client";
import { Car, Clock, LayoutDashboard, LogOut, Menu, User as UserIcon, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { inr } from "@/lib/format";
import { Avatar } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-500 text-lg shadow-pop">🚕</span>
      <span className="font-display text-2xl font-extrabold tracking-tight">
        Go<span className="gradient-text">Cab</span>
      </span>
    </Link>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = !user
    ? []
    : user.role === "driver"
      ? [
          { href: "/driver", label: "Dashboard", icon: LayoutDashboard },
          { href: "/history", label: "Trips", icon: Clock },
          { href: "/wallet", label: "Earnings", icon: Wallet },
          { href: "/profile", label: "Profile", icon: UserIcon },
        ]
      : [
          { href: "/ride", label: "Book a ride", icon: Car },
          { href: "/history", label: "My rides", icon: Clock },
          { href: "/wallet", label: "Wallet", icon: Wallet },
          { href: "/profile", label: "Profile", icon: UserIcon },
        ];

  const doLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-[1500] border-b border-white/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${path === l.href ? "bg-violet-600 text-white shadow-pop" : "text-ink-soft hover:bg-violet-50 hover:text-violet-700"}`}>
              <l.icon className="h-4 w-4" />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link href="/wallet" className="hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-100 to-orange-100 px-3 py-1.5 text-sm font-bold text-orange-700 sm:flex">
                <Wallet className="h-4 w-4" /> {inr(user.wallet_balance)}
              </Link>
              <Link href="/profile" className="hidden sm:block" title={user.name}>
                <Avatar name={user.name} size={36} />
              </Link>
              <button onClick={doLogout} className="hidden rounded-xl p-2 text-ink-soft hover:bg-rose-50 hover:text-rose-600 md:block" title="Log out" aria-label="Log out">
                <LogOut className="h-5 w-5" />
              </button>
              <button className="rounded-xl p-2 md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
                {open ? <X /> : <Menu />}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost !py-2 text-sm">Log in</Link>
              <Link href="/register" className="btn-primary !py-2 text-sm">Sign up</Link>
            </>
          )}
        </div>
      </div>
      {open && user && (
        <div className="border-t border-violet-100 bg-white px-4 pb-4 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
              className={`mt-1 flex items-center gap-3 rounded-xl px-3 py-3 font-semibold ${path === l.href ? "bg-violet-100 text-violet-700" : "text-ink-soft"}`}>
              <l.icon className="h-5 w-5" /> {l.label}
            </Link>
          ))}
          <button onClick={doLogout} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 font-semibold text-rose-600">
            <LogOut className="h-5 w-5" /> Log out
          </button>
        </div>
      )}
    </header>
  );
}
