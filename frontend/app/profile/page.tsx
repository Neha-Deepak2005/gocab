"use client";
import { Car, Mail, Phone, Save, Star } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import useSWR from "swr";
import { Avatar, PageLoader, Stars } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { VEHICLE_META, when } from "@/lib/format";

type Summary = { average: number; count: number; distribution: Record<string, number>; reviews: { id: number; rating: number; comment: string | null; created_at: string; rater_name: string }[] };

export default function ProfilePage() {
  const { user, ready } = useRequireAuth();
  const { refresh } = useAuth();
  const { data: summary } = useSWR<Summary>(ready && user ? `/api/reviews/user/${user.id}` : null, fetcher);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [veh, setVeh] = useState({ vehicle_type: "mini", vehicle_model: "", vehicle_number: "", vehicle_color: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({ name: user.name, phone: user.phone ?? "" });
    if (user.driver) setVeh({ vehicle_type: user.driver.vehicle_type, vehicle_model: user.driver.vehicle_model, vehicle_number: user.driver.vehicle_number, vehicle_color: user.driver.vehicle_color });
  }, [user]);

  if (!ready || !user) return <PageLoader />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/users/me", { method: "PATCH", json: { name: form.name, phone: form.phone || null } });
      if (user.role === "driver") await api("/api/drivers/me", { method: "PATCH", json: veh });
      await refresh();
      toast.success("Profile updated ✨");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-5">
      <div className="space-y-5 md:col-span-2">
        <div className="card overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-orange-500" />
          <div className="-mt-10 flex flex-col items-center px-5 pb-6 text-center">
            <Avatar name={user.name} size={80} className="border-4 border-white" />
            <h1 className="mt-2 font-display text-2xl font-extrabold">{user.name}</h1>
            <span className={`chip mt-1 ${user.role === "driver" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"}`}>{user.role === "driver" ? "🚘 Driver" : "🙋 Rider"}</span>
            <div className="mt-3 flex items-center gap-2"><Stars value={user.rating_avg} /> <span className="font-bold">{user.rating_avg.toFixed(1)}</span><span className="text-sm text-ink-mute">({user.rating_count})</span></div>
            <div className="mt-4 w-full space-y-2 text-left text-sm">
              <div className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2"><Mail className="h-4 w-4 text-violet-600" /> {user.email}</div>
              {user.phone && <div className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2"><Phone className="h-4 w-4 text-violet-600" /> {user.phone}</div>}
              {user.driver && <div className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2"><Car className="h-4 w-4 text-violet-600" /> {VEHICLE_META[user.driver.vehicle_type]?.emoji} {user.driver.vehicle_color} {user.driver.vehicle_model} · {user.driver.vehicle_number}</div>}
            </div>
            <div className="mt-3 text-xs text-ink-mute">Member since {new Date(user.created_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</div>
          </div>
        </div>

        {summary && (
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Star className="h-5 w-5 fill-amber-400 text-amber-400" /> Ratings received</h2>
            <div className="flex items-center gap-5">
              <div className="text-center">
                <div className="font-display text-5xl font-extrabold">{summary.count ? summary.average.toFixed(1) : "–"}</div>
                <div className="text-xs text-ink-mute">{summary.count} reviews</div>
              </div>
              <div className="flex-1 space-y-1">
                {[5, 4, 3, 2, 1].map((s) => {
                  const c = summary.distribution[s] ?? 0;
                  return (
                    <div key={s} className="flex items-center gap-2 text-xs font-semibold">
                      <span className="w-3">{s}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${summary.count ? (c / summary.count) * 100 : 0}%` }} />
                      </div>
                      <span className="w-5 text-right text-ink-mute">{c}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5 md:col-span-3">
        <form onSubmit={save} className="card space-y-4 p-6">
          <h2 className="font-display text-xl font-bold">Edit profile</h2>
          <div><label className="label" htmlFor="pname">Name</label><input id="pname" className="input" value={form.name} minLength={2} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="pphone">Phone</label><input id="pphone" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 …" /></div>
          {user.role === "driver" && (
            <div className="space-y-3 rounded-2xl bg-orange-50/70 p-4">
              <span className="label">Vehicle</span>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(VEHICLE_META).map(([k, v]) => (
                  <button type="button" key={k} onClick={() => setVeh({ ...veh, vehicle_type: k })}
                    className={`flex flex-col items-center rounded-xl bg-white py-2 ${veh.vehicle_type === k ? `ring-2 ${v.ring}` : "opacity-60"}`}>
                    <span className="text-2xl">{v.emoji}</span><span className="text-[11px] font-bold">{v.label}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input className="input" value={veh.vehicle_model} onChange={(e) => setVeh({ ...veh, vehicle_model: e.target.value })} placeholder="Model" aria-label="Model" />
                <input className="input" value={veh.vehicle_number} onChange={(e) => setVeh({ ...veh, vehicle_number: e.target.value })} placeholder="Number" aria-label="Number" />
                <input className="input" value={veh.vehicle_color} onChange={(e) => setVeh({ ...veh, vehicle_color: e.target.value })} placeholder="Colour" aria-label="Colour" />
              </div>
            </div>
          )}
          <button className="btn-primary" disabled={saving}><Save className="h-5 w-5" /> Save changes</button>
        </form>

        <div className="card p-6">
          <h2 className="mb-3 font-display text-xl font-bold">Recent reviews</h2>
          {!summary?.reviews.length ? (
            <p className="py-6 text-center text-ink-soft">No reviews yet — they'll appear after your trips ⭐</p>
          ) : (
            <div className="space-y-3">
              {summary.reviews.map((r) => (
                <div key={r.id} className="rounded-2xl bg-violet-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Avatar name={r.rater_name} size={30} /><span className="font-bold">{r.rater_name}</span></div>
                    <Stars value={r.rating} size={14} />
                  </div>
                  {r.comment && <p className="mt-2 text-sm text-ink-soft">{r.comment}</p>}
                  <div className="mt-1 text-xs text-ink-mute">{when(r.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
