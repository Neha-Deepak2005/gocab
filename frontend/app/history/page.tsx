"use client";
import { ChevronDown, CreditCard, Download, Mail, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import useSWR from "swr";
import PayModal from "@/components/PayModal";
import RateModal from "@/components/RateModal";
import { Avatar, Empty, PageLoader, StatusBadge } from "@/components/ui";
import { api, downloadReceipt, fetcher, type Ride } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { inr, km, mins, VEHICLE_META, when } from "@/lib/format";

const TABS = [
  { k: "all", label: "All" },
  { k: "completed", label: "Completed" },
  { k: "active", label: "Active" },
  { k: "cancelled", label: "Cancelled" },
];

export default function HistoryPage() {
  const { user, ready } = useRequireAuth();
  const { refresh } = useAuth();
  const { data: rides, mutate, isLoading } = useSWR<Ride[]>(ready ? "/api/rides?limit=100" : null, fetcher);
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const [payRide, setPayRide] = useState<Ride | null>(null);
  const [rateRide, setRateRide] = useState<Ride | null>(null);

  const isDriver = user?.role === "driver";
  const list = useMemo(() => (rides ?? []).filter((r) =>
    tab === "all" ? true : tab === "active" ? ["requested", "accepted", "arrived", "started"].includes(r.status) : r.status === tab), [rides, tab]);

  const totals = useMemo(() => {
    const done = (rides ?? []).filter((r) => r.status === "completed");
    return {
      count: done.length,
      spent: done.reduce((a, r) => a + (r.fare_actual ?? 0), 0),
      dist: done.reduce((a, r) => a + r.distance_meters, 0),
    };
  }, [rides]);

  if (!ready || isLoading) return <PageLoader />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-3xl font-extrabold">{isDriver ? "Your trips" : "Your rides"}</h1>
      <p className="text-ink-soft">Receipts, ratings and payments — all in one place</p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          [isDriver ? "Trips done" : "Rides taken", String(totals.count), "from-violet-500 to-fuchsia-500", "🚕"],
          [isDriver ? "Fares" : "Total spent", inr(totals.spent), "from-amber-400 to-orange-500", "💰"],
          ["Distance", km(totals.dist), "from-sky-400 to-blue-500", "🛣️"],
        ].map(([l, v, c, e]) => (
          <div key={l} className={`rounded-3xl bg-gradient-to-br ${c} p-4 text-white shadow-card`}>
            <div className="text-2xl">{e}</div>
            <div className="mt-1 font-display text-xl font-extrabold sm:text-2xl">{v}</div>
            <div className="text-xs font-semibold opacity-85">{l}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition ${tab === t.k ? "bg-violet-600 text-white shadow-pop" : "bg-white text-ink-soft hover:bg-violet-50"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {list.length === 0 && (
          <Empty emoji="🧭" title="No rides here yet" text={isDriver ? "Go online to start receiving trips." : "Your adventures will show up here."}>
            <Link href={isDriver ? "/driver" : "/ride"} className="btn-primary">{isDriver ? "Go to dashboard" : "Book a ride"}</Link>
          </Empty>
        )}
        {list.map((r) => {
          const m = VEHICLE_META[r.vehicle_type];
          const other = isDriver ? r.rider : r.driver;
          const expanded = open === r.id;
          const fare = r.fare_actual ?? r.fare_estimate - r.discount;
          return (
            <div key={r.id} className="card overflow-hidden">
              <button className="flex w-full items-center gap-4 p-4 text-left" onClick={() => setOpen(expanded ? null : r.id)}>
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${m.bg} text-2xl`}>{m.emoji}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{r.drop_address || "Destination"}</div>
                  <div className="text-xs text-ink-soft">{when(r.created_at)} · {m.label} · #{r.id}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="font-display text-lg font-extrabold">{inr(fare)}</div>
                  <StatusBadge status={r.status} />
                </div>
                <ChevronDown className={`h-5 w-5 shrink-0 text-ink-mute transition ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <div className="border-t border-violet-100 bg-violet-50/40 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 text-sm font-semibold">
                      <div className="flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />{r.pickup_address || "Pickup"}</div>
                      <div className="flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-pink-600" />{r.drop_address || "Drop"}</div>
                      <div className="pt-1 text-xs font-medium text-ink-soft">{km(r.distance_meters)} · {mins(r.duration_secs)} · <span className="capitalize">{r.payment_method}</span> · {r.payment_status}</div>
                      {r.cancel_reason && <div className="text-xs text-rose-600">Reason: {r.cancel_reason}</div>}
                    </div>
                    <div className="rounded-2xl bg-white p-3 text-sm">
                      <div className="flex justify-between"><span className="text-ink-soft">Fare</span><span>{inr(r.fare_estimate)}</span></div>
                      {r.surge > 1 && <div className="flex justify-between"><span className="text-ink-soft">Surge</span><span>{r.surge}x incl.</span></div>}
                      {r.discount > 0 && <div className="flex justify-between text-emerald-600"><span>Promo {r.promo_code}</span><span>-{inr(r.discount)}</span></div>}
                      <div className="mt-1 flex justify-between border-t border-violet-100 pt-1 font-bold"><span>Total</span><span>{inr(fare)}</span></div>
                    </div>
                  </div>
                  {other && (
                    <div className="mt-4 flex items-center gap-3">
                      <Avatar name={other.name} size={36} />
                      <div className="text-sm"><div className="font-bold">{other.name}</div><div className="text-xs text-ink-soft">{other.rating_avg.toFixed(1)} ★</div></div>
                    </div>
                  )}
                  {r.status === "completed" && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button className="btn-ghost !py-2 text-sm" onClick={() => downloadReceipt(r.id).catch((e) => toast.error(e.message))}><Download className="h-4 w-4" /> Receipt PDF</button>
                      {!isDriver && <button className="btn-ghost !py-2 text-sm" onClick={() => api(`/api/rides/${r.id}/email-receipt`, { method: "POST" }).then((x: any) => toast.success(`Receipt sent to ${x.to}`)).catch((e) => toast.error(e.message))}><Mail className="h-4 w-4" /> Email receipt</button>}
                      {!isDriver && r.payment_status !== "paid" && <button className="btn-primary !py-2 text-sm" onClick={() => setPayRide(r)}><CreditCard className="h-4 w-4" /> Pay now</button>}
                      {r.my_review ? (
                        <span className="chip bg-amber-100 !py-2 text-amber-700">You rated {r.my_review} ★</span>
                      ) : other && (
                        <button className="btn-soft !py-2 text-sm" onClick={() => setRateRide(r)}><Star className="h-4 w-4" /> Rate {isDriver ? "rider" : "driver"}</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {payRide && <PayModal open onClose={() => setPayRide(null)} createPath={`/api/payments/ride/${payRide.id}/intent`} title={`Pay for ride #${payRide.id}`} onPaid={() => { mutate(); refresh(); }} />}
      {rateRide && <RateModal open onClose={() => setRateRide(null)} rideId={rateRide.id} name={(isDriver ? rateRide.rider : rateRide.driver)?.name ?? ""} onDone={() => mutate()} />}
    </div>
  );
}
