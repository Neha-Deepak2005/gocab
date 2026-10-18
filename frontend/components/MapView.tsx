"use client";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLng } from "@/lib/api";
import { VEHICLE_META } from "@/lib/format";

export type MapProps = {
  center: LatLng;
  pickup?: LatLng | null;
  drop?: LatLng | null;
  route?: [number, number][] | null;
  driver?: LatLng | null;
  driverType?: string;
  cars?: { id: number; lat: number; lng: number; vehicle_type: string }[];
  me?: LatLng | null;
  onClick?: (p: LatLng) => void;
  className?: string;
  follow?: boolean;
};

const pin = (color: string, label: string) =>
  L.divIcon({
    className: "gc-pin",
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};
        box-shadow:0 6px 16px -4px ${color};display:flex;align-items:center;justify-content:center;border:3px solid #fff">
        <span style="transform:rotate(45deg);color:#fff;font-weight:800;font-size:13px">${label}</span></div></div>`,
  });

const carIcon = (type: string, big = false) =>
  L.divIcon({
    className: "gc-pin gc-car",
    iconSize: big ? [46, 46] : [32, 32],
    iconAnchor: big ? [23, 23] : [16, 16],
    html: `<div style="width:100%;height:100%;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;
      font-size:${big ? 26 : 17}px;box-shadow:0 4px 14px -2px rgba(124,58,237,.55);border:${big ? 3 : 2}px solid ${big ? "#db2777" : "#a78bfa"}">
      ${VEHICLE_META[type]?.emoji ?? "🚗"}</div>`,
  });

const meIcon = L.divIcon({
  className: "gc-pin",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;border:4px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.25)"></div>`,
});

function Fit({ points, follow }: { points: LatLng[]; follow?: boolean }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.flyTo([points[0].lat, points[0].lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
    else map.flyToBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [60, 60], duration: 0.8, maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow ? key : key.split("|").slice(0, 2).join("|") + points.length]);
  return null;
}

function Clicks({ onClick }: { onClick?: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function MapView({ center, pickup, drop, route, driver, driverType = "mini", cars = [], me, onClick, className, follow }: MapProps) {
  const fitPoints = useMemo(() => {
    const pts: LatLng[] = [];
    if (driver) pts.push(driver);
    if (pickup) pts.push(pickup);
    if (drop) pts.push(drop);
    return pts;
  }, [driver, pickup, drop]);

  return (
    <MapContainer center={[center.lat, center.lng]} zoom={14} className={className ?? "h-full w-full"} zoomControl={false} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Clicks onClick={onClick} />
      <Fit points={fitPoints} follow={follow} />
      {route && route.length > 1 && (
        <>
          <Polyline positions={route} pathOptions={{ color: "#c4b5fd", weight: 10, opacity: 0.6 }} />
          <Polyline positions={route} pathOptions={{ color: "#7c3aed", weight: 5, dashArray: undefined }} />
        </>
      )}
      {me && !pickup && <Marker position={[me.lat, me.lng]} icon={meIcon} />}
      {cars.map((c) => (
        <Marker key={c.id} position={[c.lat, c.lng]} icon={carIcon(c.vehicle_type)} />
      ))}
      {pickup && (
        <Marker position={[pickup.lat, pickup.lng]} icon={pin("#10b981", "A")}>
          <Tooltip direction="top" offset={[0, -40]}>Pickup</Tooltip>
        </Marker>
      )}
      {drop && (
        <Marker position={[drop.lat, drop.lng]} icon={pin("#db2777", "B")}>
          <Tooltip direction="top" offset={[0, -40]}>Drop</Tooltip>
        </Marker>
      )}
      {driver && <Marker position={[driver.lat, driver.lng]} icon={carIcon(driverType, true)} zIndexOffset={1000} />}
    </MapContainer>
  );
}
