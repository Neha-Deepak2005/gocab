"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Avatar, Modal, StarPicker } from "./ui";

const TAGS = ["Smooth driving", "Polite", "Clean car", "On time", "Great music", "Knew the route"];

export default function RateModal({ open, onClose, rideId, name, onDone }: {
  open: boolean; onClose: () => void; rideId: number; name: string; onDone?: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!rating) return toast.error("Pick a star rating");
    setBusy(true);
    try {
      const text = [tags.join(", "), comment].filter(Boolean).join(" — ");
      await api("/api/reviews", { method: "POST", json: { ride_id: rideId, rating, comment: text || null } });
      toast.success("Thanks for the feedback! ⭐");
      onDone?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={name} size={64} />
        <h3 className="mt-3 font-display text-xl font-bold">How was your ride with {name.split(" ")[0]}?</h3>
        <div className="my-4"><StarPicker value={rating} onChange={setRating} /></div>
        <div className="mb-4 flex flex-wrap justify-center gap-2">
          {TAGS.map((t) => (
            <button key={t} type="button" onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
              className={`chip !px-3 !py-1.5 transition ${tags.includes(t) ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}>
              {t}
            </button>
          ))}
        </div>
        <textarea className="input min-h-[80px]" placeholder="Anything else? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
        <div className="mt-4 flex w-full gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>Later</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={busy}>Submit</button>
        </div>
      </div>
    </Modal>
  );
}
