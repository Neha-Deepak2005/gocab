"use client";
import { ArrowDownUp, BadgePercent, Banknote, Check, CreditCard, Download, Loader2, Phone, ShieldCheck, Star, Users, Wallet, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Map from "@/components/Map";
import PayModal from "@/components/PayModal";
import PlaceInput from "@/components/PlaceInput";
import RateModal from "@/components/RateModal";
import { Avatar, PageLoader, StatusBadge } from "@/components/ui";
import { api, downloadReceipt, type Estimate, type LatLng, type Ride } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { inr, km, mins, VEHICLE_META } from "@/lib/format";
import { currentPosition, DEFAULT_CENTER, reverseGeocode } from "@/lib/geo";
import { useSocket } from "@/lib/useSocket";

type Spot = LatLng & { address: string };
const PAY_METHODS = [
  { k: "cash", label: "Cash", icon: Banknote, cls: "text-emerald-600" },
  { k: "wallet", label: "Wallet", icon: Wallet, cls: "text-orange-600" },
  { k: "card", label: "Card", icon: CreditCard, cls: "text-sky-600" },
] as const;

export default function RidePage() {
  const { user, ready } = useRequireAuth("rider");
  const { refresh } = useAuth();

  const [me, setMe] = useState<LatLng | null>(null);
  const [pickup, setPickup] = useState<Spot | null>(null);
  const [drop, setDrop] = useState<Spot | null>(null);
  const [field, setField] = useState<"pickup" | "drop">("drop");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estLoading, setEstLoading] = useState(false);
  const [vehicle, setVehicle] = useState("mini");
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "wallet" | "card">("cash");
  const [booking, setBooking] = useState(false);
  const [cars, setCars] = useState<{ id: number; lat: number; lng: number; vehicle_type: string }[]>([]);

  const [ride, setRide] = useState<Ride | null>(null);
  const [driverLoc, setDriverLoc] = useState<LatLng | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [loadingRide, setLoadingRide] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);

  // ---------- initial load ----------
  useEffect(() => {
    if (!ready) return;
    api<Ride | null>("/api/rides/active").then((r) => {
      if (r) {
        setRide(r);
        setDriverLoc(r.driver_location);
      }
    }).finally(() => setLoadingRide(false));
    currentPosition()
      .then(async (p) => {
        setMe(p);
        setPickup((cur) => cur ?? { ...p, address: "Current location" });
        const address = await reverseGeocode(p.lat, p.lng);
        setPickup((cur) => (cur && cur.address === "Current location" ? { ...p, address } : cur));
      })
      .catch(() => {
        setMe(null);
        setPickup((cur) => cur ?? { ...DEFAULT_CENTER, address: "MG Road, Bengaluru" });
      });
  }, [ready]);

  // ---------- realtime ----------
  const onMsg = useCallback((msg: any) => {
    if (msg.type === "ride_update") {
      const r: Ride = msg.ride;
      setRide((cur) => {
        if (cur && cur.id !== r.id) return cur;
        if (cur?.status !== r.status) {
          const t: Record<string, string> = {
            accepted: `🚗 ${r.driver?.name} accepted your ride!`,
            arrived: "📍 Your driver has arrived — share your OTP",
            started: "🛣️ Trip started. Enjoy the ride!",
            completed: "🎉 You've arrived!",
            requested: "Driver cancelled — finding you another one…",
          };
          if (t[r.status]) toast(t[r.status], { icon: undefined });
        }
        return r;
      });
      if (r.driver_location) setDriverLoc(r.driver_location);
      if (r.status === "completed") {
        refresh();
        setEta(null);
      }
    } else if (msg.type === "driver_location") {
      setDriverLoc({ lat: msg.lat, lng: msg.lng });
      setEta(msg.eta_secs);
    }
  }, [refresh]);
  const { connected } = useSocket("rider", user?.id, onMsg);

  // polling fallback when the websocket is down
  useEffect(() => {
    if (!ride || connected || !["requested", "accepted", "arrived", "started"].includes(ride.status)) return;
    const t = setInterval(async () => {
      const r = await api<Ride>(`/api/rides/${ride.id}`).catch(() => null);
      if (r) onMsg({ type: "ride_update", ride: r });
    }, 4000);
    return () => clearInterval(t);
  }, [ride, connected, onMsg]);

  // ---------- nearby cars ----------
  useEffect(() => {
    if (!ready || ride || !pickup) return;
    const load = () => api(`/api/drivers/nearby?lat=${pickup.lat}&lng=${pickup.lng}`).then(setCars).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [ready, ride, pickup]);

  // ---------- estimate ----------
  useEffect(() => {
    if (!pickup || !drop) {
      setEstimate(null);
      return;
    }
    setEstLoading(true);
    const q = new URLSearchParams({ origin: `${pickup.lat},${pickup.lng}`, dest: `${drop.lat},${drop.lng}` });
    if (promo) q.set("promo", promo);
    api<Estimate>(`/api/rides/estimate?${q}`)
      .then((e) => {
        setEstimate(e);
        if (promo && !e.promo_applied) {
          toast.error(e.promo_message || "Promo not valid");
          setPromo(null);
        }
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setEstLoading(false));
  }, [pickup, drop, promo]);

  const selected = estimate?.options.find((o) => o.vehicle_type === vehicle);

  const onMapClick = async (p: LatLng) => {
    if (ride) return;
    const address = await reverseGeocode(p.lat, p.lng);
    if (field === "pickup") {
      setPickup({ ...p, address });
      setField("drop");
    } else setDrop({ ...p, address });
  };

  const swap = () => {
    if (!pickup || !drop) return;
    setPickup(drop);
    setDrop(pickup);
  };

  const book = async () => {
    if (!pickup || !drop || !selected) return;
    setBooking(true);
    try {
      const r = await api<Ride>("/api/rides/request", {
        method: "POST",
        json: { pickup: { lat: pickup.lat, lng: pickup.lng }, drop: { lat: drop.lat, lng: drop.lng }, pickup_address: pickup.address, drop_address: drop.address, vehicle_type: vehicle, payment_method: payMethod, promo_code: promo },
      });
      setRide(r);
      setDriverLoc(null);
      toast.success("Ride requested! Looking for drivers… 🔎");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBooking(false);
    }
  };

  const cancel = async () => {
    if (!ride) return;
    try {
      setRide(await api<Ride>(`/api/rides/${ride.id}/cancel`, { method: "POST", json: { reason: "Changed my mind" } }));
      toast("Ride cancelled", { icon: "🛑" });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reset = () => {
    setRide(null);
    setDrop(null);
    setDriverLoc(null);
    setPromo(null);
    setPromoInput("");
    setEstimate(null);
  };

  const mapRoute = useMemo(() => (ride ? ride.geometry : estimate?.geometry) ?? null, [ride, estimate]);

  if (!ready || loadingRide) return <PageLoader />;

  const center = pickup ?? me ?? DEFAULT_CENTER;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 md:h-[calc(100vh-4rem)] md:flex-row md:p-4">
      {/* -------- side panel -------- */}
      <aside className="order-2 flex w-full shrink-0 flex-col gap-4 md:order-1 md:w-[430px] md:overflow-y-auto md:pb-4 [&>*]:shrink-0">
        {ride ? (
          <Tracker ride={ride} eta={eta} onCancel={cancel} onReset={reset} onPay={() => setPayOpen(true)} onRate={() => setRateOpen(true)} />
        ) : (
          <>
            <div className="card p-5">
              <h1 className="mb-4 font-display text-2xl font-extrabold">Where to, {user!.name.split(" ")[0]}? <span className="inline-block animate-floaty">✨</span></h1>
              <div className="relative space-y-2.5">
                <PlaceInput label="Pickup" dot="pickup" value={pickup?.address ?? ""} active={field === "pickup"} onFocus={() => setField("pickup")} near={center}
                  onPick={(p) => { setPickup({ lat: p.lat, lng: p.lng, address: p.short }); setField("drop"); }}
                  onLocate={() => currentPosition().then(async (p) => { setMe(p); setPickup({ ...p, address: await reverseGeocode(p.lat, p.lng) }); }).catch(() => toast.error("Location permission denied"))} />
                <PlaceInput label="Drop" dot="drop" value={drop?.address ?? ""} active={field === "drop"} onFocus={() => setField("drop")} near={center}
                  onPick={(p) => setDrop({ lat: p.lat, lng: p.lng, address: p.short })} onClear={() => setDrop(null)} />
                <button onClick={swap} className="absolute right-14 top-[42px] z-10 rounded-full border-2 border-white bg-violet-600 p-1.5 text-white shadow-pop hover:rotate-180 hover:bg-violet-700 transition" title="Swap" aria-label="Swap pickup and drop">
                  <ArrowDownUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-3 text-xs font-medium text-ink-mute">💡 Tip: tap the map to set the {field === "pickup" ? "pickup" : "drop"} point</p>
            </div>

            {estLoading && !estimate && (
              <div className="card flex items-center justify-center gap-3 p-8 text-ink-soft"><Loader2 className="h-5 w-5 animate-spin text-violet-600" /> Calculating fares…</div>
            )}

            {estimate && (
              <>
                <div className="card p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold">Choose a ride</h2>
                    <span className="text-sm font-semibold text-ink-soft">{km(estimate.distance_meters)} · {mins(estimate.duration_secs)}</span>
                  </div>
                  {estimate.options[0]?.surge > 1 && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                      <Zap className="h-4 w-4" /> High demand — fares are {estimate.options[0].surge}x
                    </div>
                  )}
                  <div className="space-y-2">
                    {estimate.options.map((o) => {
                      const m = VEHICLE_META[o.vehicle_type];
                      const on = vehicle === o.vehicle_type;
                      return (
                        <button key={o.vehicle_type} onClick={() => setVehicle(o.vehicle_type)}
                          className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${on ? "border-violet-500 bg-violet-50/80 shadow-pop" : "border-transparent bg-white hover:bg-violet-50/50"}`}>
                          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${m.bg} text-3xl shadow-md`}>{m.emoji}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 font-bold">
                              {o.label}
                              <span className="flex items-center gap-0.5 text-xs font-semibold text-ink-mute"><Users className="h-3 w-3" />{o.seats}</span>
                            </div>
                            <div className="text-xs text-ink-soft">
                              {o.eta_minutes ? `${o.eta_minutes} min away` : "Few drivers nearby"} · {m.tag}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-display text-lg font-extrabold">{inr(o.fare)}</div>
                            {o.discount > 0 && <div className="text-xs font-semibold text-ink-mute line-through">{inr(o.fare_before_discount)}</div>}
                          </div>
                          {on && <Check className="h-5 w-5 text-violet-600" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="card space-y-4 p-5">
                  {/* promo */}
                  <div>
                    <span className="label flex items-center gap-1.5"><BadgePercent className="h-4 w-4 text-orange-500" /> Promo code</span>
                    {promo ? (
                      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3">
                        <span className="text-sm font-bold text-emerald-700">🎉 {estimate.promo_message}</span>
                        <button onClick={() => { setPromo(null); setPromoInput(""); }} className="text-emerald-700" aria-label="Remove promo"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (promoInput.trim()) setPromo(promoInput.trim().toUpperCase()); }}>
                        <input className="input !py-2.5 uppercase" placeholder="WELCOME50" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} aria-label="Promo code" />
                        <button className="btn-soft !py-2.5">Apply</button>
                      </form>
                    )}
                  </div>
                  {/* payment */}
                  <div>
                    <span className="label">Pay with</span>
                    <div className="grid grid-cols-3 gap-2">
                      {PAY_METHODS.map((p) => (
                        <button key={p.k} onClick={() => setPayMethod(p.k)}
                          className={`flex flex-col items-center gap-1 rounded-2xl border-2 py-3 text-sm font-bold transition ${payMethod === p.k ? "border-violet-500 bg-violet-50" : "border-violet-100 bg-white hover:border-violet-200"}`}>
                          <p.icon className={`h-5 w-5 ${p.cls}`} /> {p.label}
                          {p.k === "wallet" && <span className="text-[11px] font-semibold text-ink-mute">{inr(user!.wallet_balance)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="btn-primary w-full text-lg" onClick={book} disabled={booking || !selected}>
                    {booking ? <Loader2 className="h-5 w-5 animate-spin" /> : VEHICLE_META[vehicle].emoji} Book {selected?.label} · {inr(selected?.fare)}
                  </button>
                </div>
              </>
            )}

            {!drop && (
              <div className="card bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-500 p-5 text-white">
                <div className="font-display text-lg font-bold">🎁 Offers for you</div>
                <p className="text-sm text-white/85">Use <b>WELCOME50</b> for 50% off · <b>FLAT40</b> for ₹40 off rides above ₹150</p>
              </div>
            )}
          </>
        )}
      </aside>

      {/* -------- map -------- */}
      <section className="relative order-1 h-[45vh] overflow-hidden rounded-3xl shadow-card md:order-2 md:h-full md:flex-1">
        <Map center={center} me={me} pickup={ride ? { lat: ride.pickup_lat, lng: ride.pickup_lng } : pickup} drop={ride ? { lat: ride.drop_lat, lng: ride.drop_lng } : drop}
          route={mapRoute} driver={ride && ride.status !== "completed" && ride.status !== "cancelled" ? driverLoc : null} driverType={ride?.vehicle_type}
          cars={ride ? [] : cars} onClick={onMapClick} follow={!!ride} />
        <div className="pointer-events-none absolute left-3 top-3 z-[500] flex gap-2">
          <span className={`chip pointer-events-auto bg-white shadow-card ${connected ? "text-emerald-600" : "text-amber-600"}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`} /> {connected ? "Live" : "Connecting…"}
          </span>
          {!ride && cars.length > 0 && <span className="chip bg-white text-violet-700 shadow-card">🚗 {cars.length} drivers nearby</span>}
        </div>
      </section>

      {ride && (
        <>
          <PayModal open={payOpen} onClose={() => setPayOpen(false)} createPath={`/api/payments/ride/${ride.id}/intent`} title={`Pay for ride #${ride.id}`}
            onPaid={async () => { setRide(await api<Ride>(`/api/rides/${ride.id}`)); refresh(); }} />
          {ride.driver && (
            <RateModal open={rateOpen} onClose={() => setRateOpen(false)} rideId={ride.id} name={ride.driver.name}
              onDone={async () => setRide(await api<Ride>(`/api/rides/${ride.id}`))} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------- live ride panel ----------------
const STEPS = ["requested", "accepted", "arrived", "started", "completed"];

function Tracker({ ride, eta, onCancel, onReset, onPay, onRate }: {
  ride: Ride; eta: number | null; onCancel: () => void; onReset: () => void; onPay: () => void; onRate: () => void;
}) {
  const m = VEHICLE_META[ride.vehicle_type];
  const idx = STEPS.indexOf(ride.status);
  const fare = ride.fare_actual ?? ride.fare_estimate - ride.discount;

  if (ride.status === "cancelled") {
    return (
      <div className="card p-6 text-center">
        <div className="text-5xl">🛑</div>
        <h2 className="mt-2 font-display text-xl font-bold">Ride cancelled</h2>
        <p className="text-ink-soft">{ride.cancel_reason}</p>
        <button className="btn-primary mt-5 w-full" onClick={onReset}>Book a new ride</button>
      </div>
    );
  }

  const headline: Record<string, [string, string]> = {
    requested: ["Finding your driver…", "Hang tight, we're matching you with the nearest driver"],
    accepted: [eta != null ? `Arriving in ${mins(eta)}` : "Driver is on the way", "Meet your driver at the pickup point"],
    arrived: ["Your driver is here! 📍", "Share the OTP below to start the trip"],
    started: [eta != null ? `${mins(eta)} to destination` : "On the way", "Sit back and enjoy the ride"],
    completed: ["You've arrived! 🎉", "Thanks for riding with GoCab"],
  };
  const [title, sub] = headline[ride.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-500 p-5 text-white">
          <div className="flex items-center justify-between">
            <StatusBadge status={ride.status} />
            <span className="text-sm font-semibold opacity-80">Ride #{ride.id}</span>
          </div>
          <h2 className="mt-3 font-display text-2xl font-extrabold">{title}</h2>
          <p className="text-sm text-white/85">{sub}</p>
          {/* progress */}
          <div className="mt-4 flex gap-1.5">
            {STEPS.slice(0, 5).map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-white" : "bg-white/30"} ${i === idx && ride.status !== "completed" ? "animate-pulse" : ""}`} />
            ))}
          </div>
        </div>

        {ride.status === "requested" && (
          <div className="flex flex-col items-center p-8">
            <div className="relative flex h-24 w-24 items-center justify-center">
              <span className="absolute h-full w-full animate-pulseRing rounded-full bg-violet-400" />
              <span className="absolute h-full w-full animate-pulseRing rounded-full bg-fuchsia-400 [animation-delay:.6s]" />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white text-4xl shadow-pop">{m.emoji}</span>
            </div>
            <p className="mt-4 text-sm font-semibold text-ink-soft">Searching for {m.label} drivers nearby</p>
          </div>
        )}

        {ride.driver && ride.vehicle && ride.status !== "requested" && (
          <div className="p-5">
            <div className="flex items-center gap-3">
              <Avatar name={ride.driver.name} size={56} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-bold">{ride.driver.name}</div>
                <div className="flex items-center gap-1 text-sm text-ink-soft"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {ride.driver.rating_avg.toFixed(1)} <span className="text-ink-mute">({ride.driver.rating_count})</span></div>
              </div>
              {ride.driver.phone && ride.status !== "completed" && (
                <a href={`tel:${ride.driver.phone}`} className="rounded-2xl bg-emerald-100 p-3 text-emerald-700 hover:bg-emerald-200" aria-label="Call driver"><Phone className="h-5 w-5" /></a>
              )}
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-violet-50 p-3">
              <span className="text-3xl">{m.emoji}</span>
              <div className="flex-1">
                <div className="font-bold">{ride.vehicle.vehicle_color} {ride.vehicle.vehicle_model}</div>
                <div className="text-xs font-semibold text-ink-soft">{m.label}</div>
              </div>
              <div className="rounded-lg border-2 border-ink bg-amber-300 px-2 py-0.5 font-mono text-sm font-bold">{ride.vehicle.vehicle_number}</div>
            </div>
          </div>
        )}

        {ride.otp && ["accepted", "arrived"].includes(ride.status) && (
          <div className="mx-5 mb-5 flex items-center justify-between rounded-2xl border-2 border-dashed border-fuchsia-300 bg-fuchsia-50 p-4">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-bold text-fuchsia-700"><ShieldCheck className="h-4 w-4" /> Trip OTP</div>
              <div className="text-xs text-ink-soft">Share with your driver to start</div>
            </div>
            <div className="flex gap-1.5">
              {ride.otp.split("").map((d, i) => (
                <span key={i} className="flex h-11 w-9 items-center justify-center rounded-xl bg-white font-display text-2xl font-extrabold text-fuchsia-700 shadow-card">{d}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* trip summary */}
      <div className="card p-5">
        <div className="space-y-3">
          <div className="flex gap-3"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-100" /><span className="text-sm font-semibold">{ride.pickup_address || "Pickup"}</span></div>
          <div className="flex gap-3"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-pink-600 ring-4 ring-pink-100" /><span className="text-sm font-semibold">{ride.drop_address || "Drop"}</span></div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-violet-100 pt-4">
          <div className="text-sm text-ink-soft">{km(ride.distance_meters)} · {mins(ride.duration_secs)} · <span className="font-semibold capitalize">{ride.payment_method}</span>
            {ride.promo_code && <span className="chip ml-2 bg-emerald-100 text-emerald-700">{ride.promo_code}</span>}
          </div>
          <div className="font-display text-2xl font-extrabold">{inr(fare)}</div>
        </div>
      </div>

      {ride.status === "completed" ? (
        <div className="card space-y-2.5 p-5">
          {ride.payment_status !== "paid" ? (
            <button className="btn-primary w-full text-lg" onClick={onPay}><CreditCard className="h-5 w-5" /> Pay {inr(fare)}</button>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-3 font-bold text-emerald-700"><Check className="h-5 w-5" /> Paid via {ride.payment_method}</div>
          )}
          {ride.my_review ? (
            <div className="flex items-center justify-center gap-2 py-1 text-sm font-semibold text-ink-soft">You rated {ride.my_review} <Star className="h-4 w-4 fill-amber-400 text-amber-400" /></div>
          ) : (
            <button className="btn-soft w-full" onClick={onRate}><Star className="h-5 w-5" /> Rate your driver</button>
          )}
          <button className="btn-ghost w-full" onClick={() => downloadReceipt(ride.id).catch((e) => toast.error(e.message))}><Download className="h-5 w-5" /> Download receipt</button>
          <button className="w-full py-2 text-sm font-bold text-violet-600 hover:underline" onClick={onReset}>Book another ride →</button>
        </div>
      ) : (
        ride.status !== "started" && (
          <button className="btn-danger w-full" onClick={onCancel}><X className="h-5 w-5" /> Cancel ride</button>
        )
      )}
    </div>
  );
}
