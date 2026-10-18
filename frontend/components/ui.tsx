"use client";
import { Star } from "lucide-react";
import { useState } from "react";
import { initials, STATUS_META } from "@/lib/format";

export function Avatar({ name, size = 44, className = "" }: { name: string; size?: number; className?: string }) {
  const hues = ["from-violet-500 to-fuchsia-500", "from-sky-500 to-indigo-500", "from-amber-400 to-orange-500", "from-emerald-400 to-teal-500", "from-rose-500 to-pink-500"];
  const h = hues[name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${h} font-bold text-white shadow-md ${className}`}>
      {initials(name)}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: "bg-gray-100 text-gray-700" };
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-gray-200"} />
      ))}
    </span>
  );
}

export function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const labels = ["", "Bad", "Meh", "Okay", "Great", "Amazing!"];
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => onChange(i)} aria-label={`${i} stars`}
            className="transition hover:scale-125">
            <Star className={`h-9 w-9 ${(hover || value) >= i ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />
          </button>
        ))}
      </div>
      <span className="h-5 text-sm font-semibold text-amber-600">{labels[hover || value]}</span>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <div className={`h-6 w-6 animate-spin rounded-full border-[3px] border-violet-200 border-t-violet-600 ${className}`} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="h-10 w-10" />
    </div>
  );
}

export function Empty({ emoji, title, text, children }: { emoji: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 animate-floaty text-6xl">{emoji}</div>
      <h3 className="font-display text-xl font-bold">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-ink-soft">{text}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        {title && <h3 className="mb-4 font-display text-xl font-bold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
