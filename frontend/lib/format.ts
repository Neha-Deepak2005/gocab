export const inr = (n: number | null | undefined) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const mins = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const VEHICLE_META: Record<string, { emoji: string; label: string; color: string; ring: string; bg: string; tag: string }> = {
  bike: { emoji: "🏍️", label: "Bike", color: "text-emerald-600", ring: "ring-emerald-400", bg: "from-emerald-400 to-teal-500", tag: "Beat the traffic" },
  auto: { emoji: "🛺", label: "Auto", color: "text-amber-600", ring: "ring-amber-400", bg: "from-amber-400 to-orange-500", tag: "Quick & cheap" },
  mini: { emoji: "🚗", label: "Mini", color: "text-sky-600", ring: "ring-sky-400", bg: "from-sky-400 to-blue-500", tag: "Comfy hatchbacks" },
  sedan: { emoji: "🚘", label: "Sedan", color: "text-violet-600", ring: "ring-violet-400", bg: "from-violet-500 to-fuchsia-500", tag: "Extra legroom" },
  suv: { emoji: "🚙", label: "SUV XL", color: "text-rose-600", ring: "ring-rose-400", bg: "from-rose-500 to-pink-500", tag: "Groups up to 6" },
};

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  requested: { label: "Finding driver", cls: "bg-amber-100 text-amber-700" },
  accepted: { label: "Driver on the way", cls: "bg-sky-100 text-sky-700" },
  arrived: { label: "Driver arrived", cls: "bg-fuchsia-100 text-fuchsia-700" },
  started: { label: "On trip", cls: "bg-violet-100 text-violet-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-rose-100 text-rose-700" },
};

export const initials = (name: string) =>
  name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
