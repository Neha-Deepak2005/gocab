"use client";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CreditCard, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { inr } from "@/lib/format";
import { Modal, Spinner } from "./ui";

type Intent = { payment_id: number; mode: "stripe" | "demo"; client_secret: string | null; amount: number; status: string };

let stripePromise: Promise<Stripe | null> | null = null;
async function getStripe() {
  if (!stripePromise) {
    const cfg = await api<{ mode: string; publishable_key: string | null }>("/api/payments/config");
    stripePromise = cfg.publishable_key ? loadStripe(cfg.publishable_key) : Promise.resolve(null);
  }
  return stripePromise;
}

function StripeForm({ intent, onDone }: { intent: Intent; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const { error } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) {
      toast.error(error.message || "Payment failed");
      setBusy(false);
      return;
    }
    await api(`/api/payments/${intent.payment_id}/confirm`, { method: "POST" });
    toast.success("Payment successful 🎉");
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      <button className="btn-primary w-full" disabled={!stripe || busy}>
        {busy ? <Spinner className="!h-5 !w-5 border-white/40 border-t-white" /> : <Lock className="h-4 w-4" />} Pay {inr(intent.amount)}
      </button>
      <p className="text-center text-xs text-ink-mute">Test card: 4242 4242 4242 4242 · any future date · any CVC</p>
    </form>
  );
}

/** Creates the intent via `createPath` and shows Stripe Elements (or completes instantly in demo mode). */
export default function PayModal({ open, onClose, createPath, body, title, onPaid }: {
  open: boolean; onClose: () => void; createPath: string; body?: unknown; title: string; onPaid: () => void;
}) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [stripe, setStripe] = useState<Promise<Stripe | null> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIntent(null);
      setErr(null);
      return;
    }
    (async () => {
      try {
        const it = await api<Intent>(createPath, { method: "POST", json: body ?? {} });
        if (it.mode === "demo" || it.status === "succeeded") {
          toast.success(`Paid ${inr(it.amount)} (demo payment) 🎉`);
          onPaid();
          onClose();
          return;
        }
        setStripe(getStripe());
        setIntent(it);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {err && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
      {!err && !intent && (
        <div className="flex flex-col items-center gap-3 py-8 text-ink-soft">
          <CreditCard className="h-8 w-8 animate-pulse text-violet-500" /> Preparing secure payment…
        </div>
      )}
      {intent?.client_secret && stripe && (
        <Elements stripe={stripe} options={{ clientSecret: intent.client_secret, appearance: { theme: "stripe", variables: { colorPrimary: "#7c3aed", borderRadius: "12px" } } }}>
          <StripeForm intent={intent} onDone={() => { onPaid(); onClose(); }} />
        </Elements>
      )}
    </Modal>
  );
}
