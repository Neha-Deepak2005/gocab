"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { homeFor, useAuth } from "@/lib/auth";
import { VEHICLE_META } from "@/lib/format";

function RegisterForm() {
  const { register, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<"rider" | "driver">(params.get("role") === "driver" ? "driver" : "rider");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", vehicle_type: "mini", vehicle_model: "", vehicle_number: "", vehicle_color: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    if (user) router.replace(homeFor(user));
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { name: form.name, email: form.email, password: form.password, phone: form.phone || null, role };
      if (role === "driver") Object.assign(payload, { vehicle_type: form.vehicle_type, vehicle_model: form.vehicle_model, vehicle_number: form.vehicle_number, vehicle_color: form.vehicle_color });
      const u = await register(payload);
      toast.success(role === "rider" ? "Welcome! ₹100 added to your wallet 🎁" : "You're all set — go online to get rides 🚘");
      router.push(homeFor(u));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="card p-8">
        <h1 className="text-center font-display text-3xl font-extrabold">Join <span className="gradient-text">GoCab</span></h1>
        <p className="mb-6 text-center text-ink-soft">Takes less than a minute</p>

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-violet-50 p-1.5">
          {(["rider", "driver"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className={`rounded-xl py-3 font-bold transition ${role === r ? "bg-white text-violet-700 shadow-card" : "text-ink-soft"}`}>
              {r === "rider" ? "🙋 I want rides" : "🚘 I want to drive"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div><label className="label" htmlFor="name">Full name</label><input id="name" className="input" required minLength={2} value={form.name} onChange={set("name")} placeholder="Asha Sharma" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" /></div>
            <div><label className="label" htmlFor="phone">Phone</label><input id="phone" className="input" value={form.phone} onChange={set("phone")} placeholder="+91 98xxxxxx" /></div>
          </div>
          <div><label className="label" htmlFor="password">Password</label><input id="password" className="input" type="password" required minLength={6} value={form.password} onChange={set("password")} placeholder="At least 6 characters" /></div>

          {role === "driver" && (
            <div className="space-y-4 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 p-4">
              <div>
                <span className="label">Vehicle type</span>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(VEHICLE_META).map(([k, v]) => (
                    <button key={k} type="button" onClick={() => setForm({ ...form, vehicle_type: k })}
                      className={`flex flex-col items-center rounded-xl bg-white py-2 transition ${form.vehicle_type === k ? `ring-2 ${v.ring} shadow-card` : "opacity-70 hover:opacity-100"}`}>
                      <span className="text-2xl">{v.emoji}</span><span className="text-[11px] font-bold">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="input" required placeholder="Model (Swift)" value={form.vehicle_model} onChange={set("vehicle_model")} aria-label="Vehicle model" />
                <input className="input" required placeholder="KA01AB1234" value={form.vehicle_number} onChange={set("vehicle_number")} aria-label="Vehicle number" />
                <input className="input" placeholder="Colour" value={form.vehicle_color} onChange={set("vehicle_color")} aria-label="Vehicle colour" />
              </div>
            </div>
          )}

          <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-soft">
          Already have an account? <Link href="/login" className="font-bold text-violet-600 hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
