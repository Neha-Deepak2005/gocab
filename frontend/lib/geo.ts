// Free geocoding via OpenStreetMap Nominatim (fine for demos; swap for Google Places in production).
export type Place = { label: string; short: string; lat: number; lng: number };

const NOMINATIM = "https://nominatim.openstreetmap.org";

export async function searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  if (q.trim().length < 3) return [];
  const params = new URLSearchParams({ q, format: "json", limit: "6", addressdetails: "0" });
  if (near) {
    const d = 0.5;
    params.set("viewbox", `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
  }
  try {
    const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { "Accept-Language": "en" } });
    const data = await res.json();
    return data.map((p: any) => ({
      label: p.display_name,
      short: p.display_name.split(",").slice(0, 2).join(","),
      lat: parseFloat(p.lat),
      lng: parseFloat(p.lon),
    }));
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17`, { headers: { "Accept-Language": "en" } });
    const data = await res.json();
    return data.display_name ? data.display_name.split(",").slice(0, 3).join(",") : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 }; // Bengaluru

export const POPULAR = [
  { short: "Kempegowda Airport", label: "Kempegowda International Airport, Bengaluru", lat: 13.1989, lng: 77.7068 },
  { short: "MG Road Metro", label: "MG Road Metro Station, Bengaluru", lat: 12.9755, lng: 77.6067 },
  { short: "Koramangala", label: "Koramangala 5th Block, Bengaluru", lat: 12.9352, lng: 77.6245 },
  { short: "Indiranagar", label: "100 Feet Road, Indiranagar, Bengaluru", lat: 12.9719, lng: 77.6412 },
  { short: "Whitefield", label: "ITPL, Whitefield, Bengaluru", lat: 12.9857, lng: 77.7364 },
];
