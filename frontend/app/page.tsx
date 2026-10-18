"use client";
import { ArrowRight, BadgePercent, CreditCard, FileText, MapPinned, Radio, ShieldCheck, Star, Wallet } from "lucide-react";
import Link from "next/link";
import { useAuth, homeFor } from "@/lib/auth";
import { VEHICLE_META } from "@/lib/format";

const FEATURES = [
  { icon: MapPinned, title: "Smart fare estimates", text: "Real road distance & time with transparent fares for every ride type.", c: "from-sky-400 to-blue-600" },
  { icon: Radio, title: "Live tracking", text: "Watch your driver approach in realtime with a live ETA.", c: "from-violet-500 to-fuchsia-600" },
  { icon: CreditCard, title: "Pay your way", text: "Cash, GoCab Wallet or card via Stripe — all secured.", c: "from-emerald-400 to-teal-600" },
  { icon: BadgePercent, title: "Promo codes", text: "Apply offers like WELCOME50 right before you book.", c: "from-amber-400 to-orange-600" },
  { icon: FileText, title: "Instant receipts", text: "Download PDF receipts or get them by email.", c: "from-rose-400 to-pink-600" },
  { icon: Star, title: "Ratings & reviews", text: "Rate every trip and keep the community awesome.", c: "from-indigo-400 to-violet-600" },
];

export default function Home() {
  const { user } = useAuth();
  const cta = user ? homeFor(user) : "/register";

  return (
    <div className="overflow-hidden">
      {/* hero */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 md:grid-cols-2 md:pt-16">
        <div>
          <span className="chip mb-5 bg-white !px-3 !py-1.5 text-violet-700 shadow-card">
            <span className="relative flex h-2 w-2"><span className="absolute h-2 w-2 animate-pulseRing rounded-full bg-emerald-500" /><span className="h-2 w-2 rounded-full bg-emerald-500" /></span>
            Drivers online near you
          </span>
          <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Your city,<br /><span className="gradient-text">one tap away.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-ink-soft">
            Book bikes, autos and cabs in seconds. Live tracking, upfront fares, wallet cashback and receipts — all in one colourful app.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={cta} className="btn-primary text-lg">
              {user ? "Open app" : "Book your first ride"} <ArrowRight className="h-5 w-5" />
            </Link>
            {!user && <Link href="/register?role=driver" className="btn-ghost text-lg">Drive with us 🚘</Link>}
          </div>
          <div className="mt-8 flex items-center gap-6 text-sm font-semibold text-ink-soft">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-5 w-5 text-emerald-500" /> OTP-verified rides</span>
            <span className="flex items-center gap-1.5"><Wallet className="h-5 w-5 text-orange-500" /> ₹100 welcome bonus</span>
          </div>
        </div>

        {/* hero visual */}
        <div className="relative">
          <div className="absolute -right-10 -top-10 h-72 w-72 rounded-full bg-fuchsia-300/40 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-72 w-72 rounded-full bg-amber-300/40 blur-3xl" />
          <div className="card relative overflow-hidden p-6">
            <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-500 p-6 text-white">
              <div className="text-sm font-semibold opacity-80">Your driver is arriving</div>
              <div className="mt-1 font-display text-4xl font-extrabold">3 min</div>
              <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/15 p-3 backdrop-blur">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-2xl">🚗</div>
                <div className="flex-1">
                  <div className="font-bold">Ravi · 4.9 ★</div>
                  <div className="text-sm opacity-85">White WagonR · KA 05 MN 2231</div>
                </div>
                <div className="rounded-lg bg-white px-2.5 py-1 font-mono text-lg font-bold tracking-widest text-violet-700">4821</div>
              </div>
            </div>
            <div className="relative mt-5 h-16 overflow-hidden rounded-2xl bg-gradient-to-r from-slate-100 to-slate-50">
              <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-slate-300" />
              <div className="absolute top-2 animate-drive text-4xl">🚕</div>
            </div>
            <div className="mt-5 grid grid-cols-5 gap-2">
              {Object.entries(VEHICLE_META).map(([k, v]) => (
                <div key={k} className="flex flex-col items-center rounded-2xl bg-violet-50/70 py-3">
                  <span className="text-3xl">{v.emoji}</span>
                  <span className={`mt-1 text-xs font-bold ${v.color}`}>{v.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <h2 className="text-center font-display text-3xl font-extrabold sm:text-4xl">Everything you need for the <span className="gradient-text">perfect ride</span></h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card group p-6 transition hover:-translate-y-1 hover:shadow-pop">
              <div className={`mb-4 inline-flex rounded-2xl bg-gradient-to-br ${f.c} p-3 text-white shadow-lg transition group-hover:scale-110`}>
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="font-display text-lg font-bold">{f.title}</h3>
              <p className="mt-1 text-ink-soft">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <div className="card grid gap-8 bg-gradient-to-br from-ink to-violet-900 p-8 text-white md:grid-cols-4 md:p-12">
          <div>
            <h2 className="font-display text-3xl font-extrabold">How it works</h2>
            <p className="mt-2 text-violet-200">From tap to destination in four steps.</p>
          </div>
          {[
            ["1", "Set pickup & drop", "Search, tap the map or use your location."],
            ["2", "Pick a ride", "Compare fares and ETAs, add a promo."],
            ["3", "Track live", "Share the OTP when your driver arrives."],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-2xl bg-white/10 p-5 backdrop-blur">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 font-display text-xl font-extrabold text-ink">{n}</div>
              <div className="font-bold">{t}</div>
              <div className="text-sm text-violet-200">{d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-violet-100 py-8 text-center text-sm text-ink-mute">
        © {new Date().getFullYear()} GoCab · Built with FastAPI, Next.js & Tailwind
      </footer>
    </div>
  );
}
