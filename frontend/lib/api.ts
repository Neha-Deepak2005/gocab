export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws");

const TOKEN_KEY = "gocab_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...opts, headers, body });
  } catch {
    throw new ApiError("Can't reach the server. Is the backend running?", 0);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
      else if (Array.isArray(data.detail)) msg = data.detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join(", ");
    } catch {}
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

export const fetcher = (path: string) => api(path);

export async function downloadReceipt(rideId: number) {
  const blob = await api<Blob>(`/api/rides/${rideId}/receipt`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gocab-ride-${rideId}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- shared types ----------
export type Driver = {
  vehicle_type: string; vehicle_model: string; vehicle_number: string; vehicle_color: string;
  verified: boolean; status: string; lat: number | null; lng: number | null;
};
export type User = {
  id: number; name: string; email: string; phone: string | null; role: "rider" | "driver" | "admin";
  profile_pic: string | null; rating_avg: number; rating_count: number; wallet_balance: number;
  created_at: string; driver: Driver | null;
};
export type Person = { id: number; name: string; phone: string | null; rating_avg: number; rating_count: number; profile_pic: string | null };
export type LatLng = { lat: number; lng: number };
export type Ride = {
  id: number; rider_id: number; driver_id: number | null; vehicle_type: string;
  pickup_lat: number; pickup_lng: number; pickup_address: string;
  drop_lat: number; drop_lng: number; drop_address: string;
  status: "requested" | "accepted" | "arrived" | "started" | "completed" | "cancelled";
  fare_estimate: number; discount: number; fare_actual: number | null; surge: number;
  distance_meters: number; duration_secs: number; promo_code: string | null;
  payment_method: "cash" | "wallet" | "card"; payment_status: string;
  cancel_reason: string | null; cancelled_by: string | null;
  created_at: string; accepted_at: string | null; started_at: string | null; completed_at: string | null;
  otp: string | null; geometry: [number, number][] | null;
  rider: Person | null; driver: Person | null; vehicle: Driver | null; driver_location: LatLng | null;
  my_review: number | null; pickup_distance_m?: number;
};
export type FareOption = {
  vehicle_type: string; label: string; seats: number; fare: number; fare_before_discount: number;
  discount: number; surge: number; eta_minutes: number | null; drivers_nearby: number;
};
export type Estimate = {
  distance_meters: number; duration_secs: number; geometry: [number, number][]; provider: string;
  options: FareOption[]; promo_applied: string | null; promo_message: string | null;
};
