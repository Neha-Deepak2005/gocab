"use client";
import dynamic from "next/dynamic";
import type { MapProps } from "./MapView";

// Leaflet needs `window`, so the map is client-only.
const Map = dynamic<MapProps>(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-3xl bg-gradient-to-br from-violet-100 via-pink-50 to-amber-50">
      <div className="animate-floaty text-5xl">🗺️</div>
    </div>
  ),
});
export default Map;
