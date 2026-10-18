"use client";
import { Check, Navigation, Phone, Play, Power, Route, ShieldCheck, Star, TrendingUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Map from "@/components/Map";
import RateModal from "@/components/RateModal";
import { Avatar, PageLoader, StatusBadge } from "@/components/ui";
import { api, type Driver, type LatLng, type Ride } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { inr, km, mins, VEHICLE_META } from "@/lib/format";
import { currentPosition, DEFAULT_CENTER } from "@/lib/geo";
import { useSocket } from "@/lib/useSocket";

type Stats = { today: number; week: number; total: number; trips_today: number; trips_total: number; distance_km: number; rating: number; rating_count: number; wallet_balance: number; daily: { day: string; amount: number }[] };

function interpolate(path: [number, number][], steps: number): [number, number][] {
  if (path.length < 2) return path;
  const out: [number, number][] = [];
  const seg = path.length - 1;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * seg;
    const k = Math.min(Math.floor(t), seg - 1);
    const f = t - k;
    out.push([path[k][0] + (path[k + 1][0] - path[k][0]) * f, path[k][1] + (path[k + 1][1] - path[k][1]) * f]);
  }
  return out;
}

export default function DriverPage() {
  const { user, ready } = useRequireAuth("driver");
  const { refresh } = useAuth();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loc, setLoc] = useState<LatLng | null>(null);
  const [requests, setRequests] = useState<Ride[]>([]);
  const [ride, setRide] = useState<Ride | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStats = useCallback(() => api<Stats>("/api/drivers/stats").then(setStats).catch(() => {}), []);

  useEffect(() => {
    if (!ready) return;
    api<Driver>("/api/drivers/me").then((d) => {
      setDriver(d);
      if (d.lat != null && d.lng != null) setLoc({ lat: d.lat, lng: d.lng });
    });
    api<Ride | null>("/api/rides/active").then(setRide);
    loadStats();
  }, [ready, loadStats]);

  useEffect(() => {
    if (ready && driver?.status === "online" && !ride) api<Ride[]>("/api/drivers/requests").then(setRequests).catch(() => {});
  }, [ready, driver?.status, ride]);

  const onMsg = useCallback((msg: any) => {
    if (msg.type === "ride_request") {
      setRequests((rs) => (rs.some((r) => r.id === msg.ride.id) ? rs : [msg.ride, ...rs]));
      toast("🔔 New ride request!", { duration: 3000 });
      try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=").play(); } catch {}
    } else if (msg.type === "ride_taken") {
      setRequests((rs) => rs.filter((r) => r.id !== msg.ride_id));
    } else if (msg.type === "ride_update") {
      const r: Ride = msg.ride;
      setRide((cur) => {
        if (cur && cur.id === r.id) {
          if (r.status === "cancelled") toast("Rider cancelled the ride", { icon: "🛑" });
          if (r.driver_id !== user?.id) return null;
          return r;
        }
        return cur;
      });
      if (r.status === "completed" && r.payment_status === "paid") {
        loadStats();
        refresh();
      }
    }
  }, [user?.id, loadStats, refresh]);
  const { connected, send } = useSocket("driver", user?.id, onMsg);

  // share real GPS position while online (unless simulating)
  useEffect(() => {
    if (driver?.status === "offline" || simulating || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const l = { lat: p.coords.latitude, lng: p.coords.longitude };
        setLoc(l);
        send({ type: "location", ...l });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [driver?.status, simulating, send]);

  const toggleOnline = async () => {
    if (!driver) return;
    const goOnline = driver.status === "offline";
    let l = loc;
    if (goOnline) {
      try {
        l = await currentPosition();
      } catch {
        l = l ?? DEFAULT_CENTER;
        toast("Using last known location — tap the map to move", { icon: "📍" });
      }
      setLoc(l);
    }
    try {
      const d = await api<Driver>("/api/drivers/status", { method: "POST", json: { status: goOnline ? "online" : "offline", ...(l ?? {}) } });
      setDriver(d);
      toast.success(goOnline ? "You're online — requests will appear here 🟢" : "You're offline 💤");
      if (!goOnline) setRequests([]);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const setLocationOnMap = async (p: LatLng) => {
    if (simulating) return;
    setLoc(p);
    await api("/api/drivers/location", { method: "POST", json: p }).catch(() => {});
    if (driver?.status === "online" && !ride) api<Ride[]>("/api/drivers/requests").then(setRequests).catch(() => {});
  };

  const act = async (path: string, body?: unknown, ok?: string) => {
    if (!ride) return;
    setBusy(true);
    try {
      const r = await api<Ride>(`/api/rides/${ride.id}/${path}`, { method: "POST", json: body ?? {} });
      setRide(r.driver_id === user?.id ? r : null);
      if (ok) toast.success(ok);
      if (path === "complete") {
        stopSim();
        loadStats();
        refresh();
        setDriver((d) => (d ? { ...d, status: "online" } : d));
      }
      if (path === "cancel") setDriver((d) => (d ? { ...d, status: "online" } : d));
      return r;
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const accept = async (r: Ride) => {
    try {
      const acc = await api<Ride>(`/api/rides/${r.id}/accept`, { method: "POST" });
      setRide(acc);
      setRequests([]);
      setDriver((d) => (d ? { ...d, status: "on_trip" } : d));
      toast.success("Ride accepted! Head to pickup 🚗");
    } catch (e: any) {
      toast.error(e.message);
      setRequests((rs) => rs.filter((x) => x.id !== r.id));
    }
  };
  const decline = async (r: Ride) => {
    setRequests((rs) => rs.filter((x) => x.id !== r.id));
    await api(`/api/rides/${r.id}/decline`, { method: "POST" }).catch(() => {});
  };

  // demo helper: drive along the route, streaming location over the websocket
  const stopSim = () => {
    if (simRef.current) clearInterval(simRef.current);
    simRef.current = null;
    setSimulating(false);
  };
  const simulate = () => {
    if (!ride || !loc) return;
    if (simulating) return stopSim();
    const path: [number, number][] = ride.status === "started" && ride.geometry
      ? ride.geometry
      : [[loc.lat, loc.lng], [ride.pickup_lat, ride.pickup_lng]];
    const pts = interpolate(path, ride.status === "started" ? 40 : 20);
    let i = 0;
    setSimulating(true);
    simRef.current = setInterval(() => {
      if (i >= pts.length) return stopSim();
      const [lat, lng] = pts[i++];
      setLoc({ lat, lng });
      send({ type: "location", lat, lng });
    }, 1000);
  };
  useEffect(() => () => stopSim(), []);

  if (!ready || !driver) return <PageLoader />;
  const online = driver.status !== "offline";
  const meta = VEHICLE_META[driver.vehicle_type];
  const maxDay = Math.max(1, ...(stats?.daily.map((d) => d.amount) ?? [1]));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 md:h-[calc(100vh-4rem)] md:flex-row md:p-4">
      <aside className="order-2 flex w-full shrink-0 flex-col gap-4 md:order-1 md:w-[430px] md:overflow-y-auto md:pb-4 [&>*]:shrink-0">
        {/* online toggle */}
        <div className={`card overflow-hidden p-5 transition ${online ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white" : ""}`}>
          <div className="flex items-center gap-4">
            <button onClick={toggleOnline} disabled={driver.status === "on_trip"}
              className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full transition ${online ? "bg-white text-emerald-600" : "bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-pop"}`}
              aria-label={online ? "Go offline" : "Go online"}>
              {online && <span className="absolute h-full w-full animate-pulseRing rounded-full bg-white/60" />}
              <Power className="relative h-7 w-7" />
            </button>
            <div className="flex-1">
              <div className="font-display text-2xl font-extrabold">{driver.status === "on_trip" ? "On a trip" : online ? "You're online" : "You're offline"}</div>
              <div className={`text-sm ${online ? "text-white/85" : "text-ink-soft"}`}>
                {online ? (connected ? "Receiving ride requests in realtime" : "Reconnecting…") : "Tap to start receiving rides"}
              </div>
            </div>
            <span className="text-4xl">{meta.emoji}</span>
          </div>
        </div>

        {/* active ride */}
        {ride && ride.status !== "cancelled" && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between bg-gradient-to-r from-violet-600 to-fuchsia-600 p-4 text-white">
              <div>
                <div className="text-xs font-semibold opacity-80">Ride #{ride.id}</div>
                <div className="font-display text-xl font-extrabold">{inr(ride.fare_actual ?? ride.fare_estimate - ride.discount)}</div>
              </div>
              <StatusBadge status={ride.status} />
            </div>
            <div className="space-y-4 p-5">
              {ride.rider && (
                <div className="flex items-center gap-3">
                  <Avatar name={ride.rider.name} />
                  <div className="flex-1">
                    <div className="font-bold">{ride.rider.name}</div>
                    <div className="flex items-center gap-1 text-sm text-ink-soft"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{ride.rider.rating_avg.toFixed(1)} · <span className="capitalize">{ride.payment_method}</span></div>
                  </div>
                  {ride.rider.phone && ride.status !== "completed" && <a href={`tel:${ride.rider.phone}`} className="rounded-2xl bg-emerald-100 p-3 text-emerald-700" aria-label="Call rider"><Phone className="h-5 w-5" /></a>}
                </div>
              )}
              <div className="space-y-2.5 rounded-2xl bg-violet-50/70 p-4 text-sm font-semibold">
                <div className="flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />{ride.pickup_address || "Pickup"}</div>
                <div className="flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-pink-600" />{ride.drop_address || "Drop"}</div>
                <div className="pt-1 text-xs text-ink-soft">{km(ride.distance_meters)} · {mins(ride.duration_secs)}</div>
              </div>

              {ride.status !== "completed" && (
                <div className="grid grid-cols-2 gap-2">
                  <a className="btn-ghost !py-2.5 text-sm" target="_blank" rel="noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${ride.status === "started" ? `${ride.drop_lat},${ride.drop_lng}` : `${ride.pickup_lat},${ride.pickup_lng}`}`}>
                    <Navigation className="h-4 w-4" /> Navigate
                  </a>
                  <button className={`btn !py-2.5 text-sm ${simulating ? "bg-amber-100 text-amber-700" : "btn-soft"}`} onClick={simulate}>
                    <Route className="h-4 w-4" /> {simulating ? "Stop sim" : "Simulate drive"}
                  </button>
                </div>
              )}

              {ride.status === "accepted" && <button className="btn-primary w-full" disabled={busy} onClick={() => act("arrived", undefined, "Rider notified that you've arrived")}><Check className="h-5 w-5" /> I've arrived</button>}
              {(ride.status === "accepted" || ride.status === "arrived") && (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act("start", { otp }, "Trip started 🛣️").then(() => setOtp("")); }}>
                  <label className="label flex items-center gap-1.5" htmlFor="otp"><ShieldCheck className="h-4 w-4 text-fuchsia-600" /> Enter rider's OTP to start</label>
                  <div className="flex gap-2">
                    <input id="otp" className="input text-center font-display text-2xl font-bold tracking-[0.5em]" inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
                    <button className="btn-success" disabled={busy || otp.length !== 4}><Play className="h-5 w-5" /> Start</button>
                  </div>
                </form>
              )}
              {ride.status === "started" && <button className="btn-success w-full text-lg" disabled={busy} onClick={() => act("complete", undefined, "Trip completed 🎉")}><Check className="h-5 w-5" /> Complete trip</button>}
              {(ride.status === "accepted" || ride.status === "arrived") && (
                <button className="w-full text-sm font-bold text-rose-600 hover:underline" onClick={() => act("cancel", {}, "Ride released back to other drivers")}>Can't make it? Release ride</button>
              )}
              {ride.status === "completed" && (
                <div className="space-y-2">
                  <div className={`rounded-2xl p-3 text-center font-bold ${ride.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {ride.payment_status === "paid" ? (ride.payment_method === "cash" ? `Collect ${inr(ride.fare_actual)} in cash 💵` : "Paid online ✅") : "Waiting for rider to pay by card…"}
                  </div>
                  {!ride.my_review && ride.rider && <button className="btn-soft w-full" onClick={() => setRateOpen(true)}><Star className="h-5 w-5" /> Rate rider</button>}
                  <button className="btn-primary w-full" onClick={() => setRide(null)}>Back to requests</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* requests */}
        {!ride && online && (
          <div className="card p-5">
            <h2 className="mb-3 flex items-center justify-between font-display text-lg font-bold">
              Ride requests <span className="chip bg-violet-100 text-violet-700">{requests.length}</span>
            </h2>
            {requests.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center text-ink-soft">
                <div className="relative mb-3 flex h-16 w-16 items-center justify-center">
                  <span className="absolute h-full w-full animate-pulseRing rounded-full bg-emerald-300" />
                  <span className="relative text-4xl">📡</span>
                </div>
                Waiting for nearby requests…
                <span className="mt-1 text-xs text-ink-mute">Tip: book a {meta.label} from the rider demo in another browser</span>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((r) => (
                  <div key={r.id} className="rounded-2xl border-2 border-violet-100 p-4 transition hover:border-violet-300">
                    <div className="flex items-center justify-between">
                      <div className="font-display text-2xl font-extrabold">{inr(r.fare_estimate - r.discount)}</div>
                      <span className="chip bg-sky-100 text-sky-700">{r.pickup_distance_m != null ? `${km(r.pickup_distance_m)} away` : "Nearby"}</span>
                    </div>
                    <div className="my-3 space-y-1.5 text-sm font-semibold">
                      <div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />{r.pickup_address || "Pickup"}</div>
                      <div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pink-600" />{r.drop_address || "Drop"}</div>
                    </div>
                    <div className="mb-3 text-xs text-ink-soft">{km(r.distance_meters)} trip · {mins(r.duration_secs)} · <span className="capitalize">{r.payment_method}</span></div>
                    <div className="grid grid-cols-3 gap-2">
                      <button className="btn-ghost !py-2.5" onClick={() => decline(r)}><X className="h-4 w-4" /></button>
                      <button className="btn-success col-span-2 !py-2.5" onClick={() => accept(r)}><Check className="h-4 w-4" /> Accept</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* stats */}
        {stats && (
          <div className="card p-5">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold"><TrendingUp className="h-5 w-5 text-emerald-500" /> Earnings</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Today", inr(stats.today), "from-emerald-400 to-teal-500"],
                ["This week", inr(stats.week), "from-sky-400 to-blue-500"],
                ["Trips today", String(stats.trips_today), "from-amber-400 to-orange-500"],
                ["Rating", `${stats.rating.toFixed(1)} ★`, "from-fuchsia-500 to-pink-500"],
              ].map(([l, v, c]) => (
                <div key={l} className={`rounded-2xl bg-gradient-to-br ${c} p-4 text-white shadow-md`}>
                  <div className="text-xs font-semibold opacity-85">{l}</div>
                  <div className="font-display text-2xl font-extrabold">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">Last 7 days</div>
              <div className="flex h-28 items-end gap-2">
                {stats.daily.map((d, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1" title={inr(d.amount)}>
                    <div className="w-full rounded-t-lg bg-gradient-to-t from-violet-500 to-fuchsia-400 transition-all" style={{ height: `${Math.max(4, (d.amount / maxDay) * 88)}px` }} />
                    <span className="text-[11px] font-semibold text-ink-mute">{d.day}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-center text-sm">
              <div className="rounded-xl bg-violet-50 p-2"><div className="font-bold">{stats.trips_total}</div><div className="text-xs text-ink-soft">Total trips</div></div>
              <div className="rounded-xl bg-violet-50 p-2"><div className="font-bold">{stats.distance_km} km</div><div className="text-xs text-ink-soft">Driven</div></div>
            </div>
          </div>
        )}
      </aside>

      <section className="relative order-1 h-[45vh] overflow-hidden rounded-3xl shadow-card md:order-2 md:h-full md:flex-1">
        <Map center={loc ?? DEFAULT_CENTER} driver={loc} driverType={driver.vehicle_type}
          pickup={ride && ride.status !== "completed" ? { lat: ride.pickup_lat, lng: ride.pickup_lng } : requests[0] ? { lat: requests[0].pickup_lat, lng: requests[0].pickup_lng } : null}
          drop={ride && ride.status !== "completed" ? { lat: ride.drop_lat, lng: ride.drop_lng } : null}
          route={ride && ride.status !== "completed" ? ride.geometry : null} onClick={setLocationOnMap} />
        <div className="absolute left-3 top-3 z-[500] flex flex-wrap gap-2">
          <span className="chip bg-white text-violet-700 shadow-card">{meta.emoji} {driver.vehicle_color} {driver.vehicle_model} · {driver.vehicle_number}</span>
          {!ride && <span className="chip bg-white text-ink-soft shadow-card">📍 Tap map to move your location</span>}
        </div>
      </section>

      {ride?.rider && <RateModal open={rateOpen} onClose={() => setRateOpen(false)} rideId={ride.id} name={ride.rider.name}
        onDone={async () => setRide(await api<Ride>(`/api/rides/${ride.id}`))} />}
    </div>
  );
}
