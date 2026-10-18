"use client";
import { Crosshair, Loader2, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { POPULAR, searchPlaces, type Place } from "@/lib/geo";

type Props = {
  label: string;
  dot: "pickup" | "drop";
  value: string;
  onPick: (p: Place) => void;
  onClear?: () => void;
  onLocate?: () => void;
  near?: { lat: number; lng: number };
  active?: boolean;
  onFocus?: () => void;
};

export default function PlaceInput({ label, dot, value, onPick, onClear, onLocate, near, active, onFocus }: Props) {
  const [q, setQ] = useState(value);
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    if (!open || q === value) return;
    const t = setTimeout(async () => {
      setLoading(true);
      setResults(await searchPlaces(q, near));
      setLoading(false);
    }, 400);
    return () => clearTimeout(t);
  }, [q, open, value, near]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p: Place) => {
    onPick(p);
    setQ(p.short);
    setOpen(false);
  };
  const list = q.length >= 3 && q !== value ? results : POPULAR;

  return (
    <div ref={box} className="relative">
      <div className={`flex items-center gap-3 rounded-2xl border-2 bg-white px-3 py-2.5 transition ${active ? "border-violet-400 ring-4 ring-violet-100" : "border-violet-100"}`}>
        <span className={`h-3 w-3 shrink-0 rounded-full ring-4 ${dot === "pickup" ? "bg-emerald-500 ring-emerald-100" : "bg-pink-600 ring-pink-100"}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">{label}</div>
          <input
            className="w-full bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-mute"
            placeholder={dot === "pickup" ? "Where are you?" : "Where to?"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => {
              setOpen(true);
              onFocus?.();
            }}
            aria-label={label}
          />
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
        {q && onClear && (
          <button type="button" onClick={() => { setQ(""); onClear(); }} className="rounded-full p-1 text-ink-mute hover:bg-violet-50" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
        {onLocate && (
          <button type="button" onClick={onLocate} className="rounded-xl bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100" title="Use my location" aria-label="Use my location">
            <Crosshair className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && list.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-[1000] mt-2 max-h-72 overflow-auto rounded-2xl border border-violet-100 bg-white p-1.5 shadow-card">
          {list === POPULAR && <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">Popular places</div>}
          {list.map((p, i) => (
            <button key={i} type="button" onClick={() => pick(p)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-violet-50">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{p.short}</div>
                <div className="truncate text-xs text-ink-mute">{p.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
