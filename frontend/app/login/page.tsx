"use client";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { homeFor, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(homeFor(user));
  }, [user, router]);

  const submit = async (e: React.FormEvent, creds?: [string, string]) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(...(creds ?? [email, password]));
      toast.success(`Welcome back, ${u.name.split(" ")[0]}! 👋`);
      router.push(homeFor(u));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-10">
      <div className="card p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-3xl shadow-pop">👋</div>
          <h1 className="font-display text-3xl font-extrabold">Welcome back</h1>
          <p className="text-ink-soft">Log in to book or drive</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn-primary w-full" disabled={busy}><LogIn className="h-5 w-5" /> Log in</button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-ink-mute">
          <span className="h-px flex-1 bg-violet-100" /> or try a demo account <span className="h-px flex-1 bg-violet-100" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={(e) => submit(e, ["rider@gocab.app", "demo1234"])} disabled={busy}
            className="btn rounded-2xl bg-gradient-to-br from-sky-100 to-violet-100 text-violet-700 hover:brightness-95">🙋 Rider demo</button>
          <button onClick={(e) => submit(e, ["driver@gocab.app", "demo1234"])} disabled={busy}
            className="btn rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 text-orange-700 hover:brightness-95">🚘 Driver demo</button>
        </div>
        <p className="mt-6 text-center text-sm text-ink-soft">
          New here? <Link href="/register" className="font-bold text-violet-600 hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
