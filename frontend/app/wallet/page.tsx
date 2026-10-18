"use client";
import { ArrowDownLeft, ArrowUpRight, Copy, Gift, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import useSWR from "swr";
import PayModal from "@/components/PayModal";
import { PageLoader } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { inr, when } from "@/lib/format";

type Wallet = { balance: number; transactions: { id: number; amount: number; kind: string; description: string; created_at: string }[] };
type Promo = { code: string; description: string; discount_type: string; value: number; max_discount: number | null; min_fare: number };

const KIND: Record<string, string> = { topup: "💳", ride: "🚕", refund: "↩️", bonus: "🎁", earning: "💰" };
const PROMO_COLORS = ["from-violet-500 to-fuchsia-500", "from-amber-400 to-orange-500", "from-emerald-400 to-teal-500", "from-sky-400 to-blue-500"];

export default function WalletPage() {
  const { user, ready } = useRequireAuth();
  const { refresh } = useAuth();
  const { data, mutate } = useSWR<Wallet>(ready ? "/api/wallet" : null, fetcher);
  const { data: promos } = useSWR<Promo[]>(ready ? "/api/promos" : null, fetcher);
  const [amount, setAmount] = useState(500);
  const [payOpen, setPayOpen] = useState(false);

  if (!ready || !data) return <PageLoader />;
  const isDriver = user?.role === "driver";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-3xl font-extrabold">{isDriver ? "Earnings wallet" : "GoCab Wallet"}</h1>
      <p className="text-ink-soft">{isDriver ? "Online payments land here after each trip (you keep 80%)" : "Pay for rides in one tap — get 5% cashback on top-ups of ₹500+"}</p>

      <div className="mt-6 grid gap-5 md:grid-cols-5">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-500 p-6 text-white shadow-pop md:col-span-3">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 right-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="relative">
            <div className="text-sm font-semibold opacity-85">Available balance</div>
            <div className="mt-1 font-display text-5xl font-extrabold">{inr(data.balance)}</div>
            <div className="mt-6 flex items-center justify-between text-sm">
              <span className="font-semibold">{user!.name}</span>
              <span className="font-mono opacity-85">•••• {String(user!.id).padStart(4, "0")}</span>
            </div>
          </div>
        </div>

        {!isDriver && (
          <div className="card p-5 md:col-span-2">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Plus className="h-5 w-5 text-violet-600" /> Add money</h2>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {[200, 500, 1000].map((a) => (
                <button key={a} onClick={() => setAmount(a)} className={`rounded-xl py-2 font-bold transition ${amount === a ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}>₹{a}</button>
              ))}
            </div>
            <input className="input mb-2" type="number" min={1} max={50000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Amount" />
            {amount >= 500 && <p className="mb-2 flex items-center gap-1 text-xs font-bold text-emerald-600"><Sparkles className="h-3.5 w-3.5" /> You'll get {inr(amount * 0.05)} cashback!</p>}
            <button className="btn-primary w-full" disabled={!amount || amount <= 0} onClick={() => setPayOpen(true)}>Top up {inr(amount)}</button>
          </div>
        )}
      </div>

      {!isDriver && promos && promos.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 flex items-center gap-2 font-display text-xl font-bold"><Gift className="h-5 w-5 text-fuchsia-600" /> Offers for you</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {promos.map((p, i) => (
              <div key={p.code} className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${PROMO_COLORS[i % 4]} p-5 text-white shadow-card`}>
                <div className="absolute -right-6 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-[#faf7ff]" />
                <div className="font-display text-2xl font-extrabold">{p.discount_type === "percent" ? `${p.value}% OFF` : `₹${p.value} OFF`}</div>
                <div className="text-sm opacity-90">{p.description}</div>
                <button onClick={() => { navigator.clipboard?.writeText(p.code); toast.success(`${p.code} copied — apply it when booking`); }}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-white/70 bg-white/15 px-3 py-1.5 font-mono font-bold tracking-wider hover:bg-white/25">
                  {p.code} <Copy className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-3 mt-8 font-display text-xl font-bold">Transactions</h2>
      <div className="card divide-y divide-violet-50">
        {data.transactions.length === 0 && <div className="p-8 text-center text-ink-soft">No transactions yet</div>}
        {data.transactions.map((t) => (
          <div key={t.id} className="flex items-center gap-4 p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-xl">{KIND[t.kind] ?? "•"}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{t.description}</div>
              <div className="text-xs text-ink-mute">{when(t.created_at)} · <span className="capitalize">{t.kind}</span></div>
            </div>
            <div className={`flex items-center gap-1 font-display font-extrabold ${t.amount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {t.amount >= 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              {t.amount >= 0 ? "+" : "−"}{inr(Math.abs(t.amount))}
            </div>
          </div>
        ))}
      </div>

      <PayModal open={payOpen} onClose={() => setPayOpen(false)} createPath="/api/wallet/topup" body={{ amount }} title={`Add ${inr(amount)} to wallet`}
        onPaid={() => { mutate(); refresh(); }} />
    </div>
  );
}
