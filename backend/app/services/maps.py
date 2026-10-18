"""Distance / duration / route geometry + fare calculation.

Provider order:
  1. Google Directions API (if GOOGLE_MAPS_API_KEY is set)
  2. OSRM public routing server (free, no key)
  3. Straight-line (haversine) fallback so the app never breaks offline
"""
import logging
import math
from dataclasses import dataclass

import httpx

from ..config import settings

log = logging.getLogger(__name__)

EARTH_R = 6_371_000


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


@dataclass
class Route:
    distance_meters: int
    duration_secs: int
    geometry: list[list[float]]  # [[lat, lng], ...]
    provider: str


def _decode_polyline(encoded: str) -> list[list[float]]:
    """Decode a Google encoded polyline."""
    coords, index, lat, lng = [], 0, 0, 0
    while index < len(encoded):
        for is_lng in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lng:
                lng += delta
            else:
                lat += delta
        coords.append([lat / 1e5, lng / 1e5])
    return coords


def _google(o: tuple[float, float], d: tuple[float, float]) -> Route | None:
    r = httpx.get(
        "https://maps.googleapis.com/maps/api/directions/json",
        params={
            "origin": f"{o[0]},{o[1]}",
            "destination": f"{d[0]},{d[1]}",
            "mode": "driving",
            "key": settings.GOOGLE_MAPS_API_KEY,
        },
        timeout=6,
    )
    data = r.json()
    if data.get("status") != "OK":
        log.warning("Google directions failed: %s", data.get("status"))
        return None
    route = data["routes"][0]
    leg = route["legs"][0]
    return Route(
        distance_meters=leg["distance"]["value"],
        duration_secs=leg["duration"]["value"],
        geometry=_decode_polyline(route["overview_polyline"]["points"]),
        provider="google",
    )


def _osrm(o: tuple[float, float], d: tuple[float, float]) -> Route | None:
    url = f"{settings.OSRM_URL}/route/v1/driving/{o[1]},{o[0]};{d[1]},{d[0]}"
    r = httpx.get(url, params={"overview": "full", "geometries": "geojson"}, timeout=6)
    data = r.json()
    if data.get("code") != "Ok":
        return None
    route = data["routes"][0]
    return Route(
        distance_meters=int(route["distance"]),
        duration_secs=int(route["duration"]),
        geometry=[[c[1], c[0]] for c in route["geometry"]["coordinates"]],
        provider="osrm",
    )


def _straight(o: tuple[float, float], d: tuple[float, float]) -> Route:
    dist = haversine(o[0], o[1], d[0], d[1]) * 1.3  # road-winding factor
    steps = 24
    geom = [[o[0] + (d[0] - o[0]) * i / steps, o[1] + (d[1] - o[1]) * i / steps] for i in range(steps + 1)]
    return Route(int(dist), int(dist / 7.5), geom, "straight-line")  # ~27 km/h city speed


_cache: dict[tuple, Route] = {}


def get_route(origin: tuple[float, float], dest: tuple[float, float]) -> Route:
    key = (round(origin[0], 5), round(origin[1], 5), round(dest[0], 5), round(dest[1], 5))
    if key in _cache:
        return _cache[key]
    route = None
    try:
        if settings.GOOGLE_MAPS_API_KEY:
            route = _google(origin, dest)
        if route is None and settings.USE_OSRM:
            route = _osrm(origin, dest)
    except Exception as exc:  # network errors etc.
        log.info("Routing provider unavailable (%s) – using straight-line fallback", exc)
    route = route or _straight(origin, dest)
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = route
    return route


# ---------------- Fares ----------------
VEHICLES = {
    #        label         seats base  per_km per_min minimum
    "bike": ("Bike", 1, 20, 7, 1.0, 35),
    "auto": ("Auto", 3, 30, 11, 1.5, 45),
    "mini": ("Mini", 4, 50, 14, 2.0, 80),
    "sedan": ("Sedan", 4, 70, 18, 2.5, 110),
    "suv": ("SUV XL", 6, 100, 24, 3.0, 160),
}
BOOKING_FEE = 10


def calc_fare(vehicle_type: str, distance_m: int, duration_s: int, surge: float = 1.0) -> float:
    _, _, base, per_km, per_min, minimum = VEHICLES[vehicle_type]
    fare = base + per_km * distance_m / 1000 + per_min * duration_s / 60
    fare = max(fare, minimum) * surge + BOOKING_FEE
    return round(fare)
