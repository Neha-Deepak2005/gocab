# ☁️ Deploying GoCab (free tier)

You'll end up with:
- **Backend API + PostgreSQL** on **Render** → `https://gocab-api.onrender.com`
- **Frontend** on **Vercel** → `https://gocab-yourname.vercel.app`

Total time: about 15 minutes. You need GitHub, Render and Vercel accounts (all free; you can sign in to Render and Vercel with GitHub).

---

## 1. Push the code to GitHub
```bash
cd gocab
git init
git add .
git commit -m "GoCab cab booking platform"
# create an empty repo named "gocab" on github.com, then:
git remote add origin https://github.com/<your-username>/gocab.git
git branch -M main
git push -u origin main
```

## 2. Deploy the backend + database on Render
1. Go to **https://dashboard.render.com → New → Blueprint**.
2. Connect your GitHub and pick the `gocab` repo. Render reads `render.yaml` and shows **gocab-api** (web service) and **gocab-db** (Postgres).
3. It asks for the secret values marked `sync: false`. Leave them **empty** for now (the app then runs in demo-payment mode with free OSRM routing). Click **Apply**.
4. Wait for the first deploy (~5 min). The container runs `alembic upgrade head` and then starts the API.
5. Open `https://<your-api>.onrender.com/health`. You should see `{"status":"ok", ...}`, and `/docs` shows Swagger.

> **Note:** free Render services sleep after 15 minutes idle, so the first request after a pause takes ~50 s. The free Postgres expires after 30 days. For longer use, create a free Postgres on **Supabase** or **Neon** and paste its connection string into `DATABASE_URL` (Render → gocab-api → Environment).

**No Blueprint?** Do it manually: *New → PostgreSQL* (free), then *New → Web Service → your repo*, with **Root directory** = `backend`, **Runtime** = Docker, and env vars `DATABASE_URL` (Internal URL of the DB), `JWT_SECRET` (any long random string), `ENV=production` and `CORS_ORIGINS`.

## 3. Deploy the frontend on Vercel
1. Go to **https://vercel.com/new** and import the `gocab` repo.
2. Set **Root Directory** to `frontend` (the framework is detected as Next.js).
3. Add the environment variable `NEXT_PUBLIC_API_URL` = `https://<your-api>.onrender.com` (no trailing slash).
4. Click **Deploy**. You'll get a URL like `https://gocab-yourname.vercel.app`.

## 4. Connect the two (CORS)
On Render → **gocab-api → Environment**, set
`CORS_ORIGINS` = `https://gocab-yourname.vercel.app` and save (this redeploys).
(`*.vercel.app` preview URLs are already allowed by a regex in `main.py`.)

Open your Vercel URL → **Log in → Rider demo** → book a ride. A simulated driver accepts it and drives on the map. 🎉

---

## Optional: real Stripe payments (test mode)
1. Go to https://dashboard.stripe.com/test/apikeys and copy the **Publishable key** (`pk_test_…`) and **Secret key** (`sk_test_…`).
2. Add both on Render as `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY`. Set `CURRENCY=inr` (or `usd`).
3. Webhook: Stripe → **Developers → Webhooks → Add endpoint**
   - URL: `https://<your-api>.onrender.com/api/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy the **Signing secret** (`whsec_…`) into Render as `STRIPE_WEBHOOK_SECRET`.
4. Pay with test card `4242 4242 4242 4242`, any future date, any CVC.

Local webhook testing: `stripe listen --forward-to localhost:8000/api/webhooks/stripe`.

## Optional: Google Maps distance
Set `GOOGLE_MAPS_API_KEY` on Render (needs the *Directions API* enabled). Without it, the free OSRM router is used.

## Optional: Redis + Celery
- Render → **New → Key Value** (free Redis). Set `REDIS_URL` on the API → realtime events then fan out across instances, and rate limiting is shared.
- For a dedicated Celery worker, add a **Background Worker** (paid on Render) from the same repo with root `backend` and start command
  `celery -A app.tasks.celery_app worker --loglevel=info`, plus `USE_CELERY=true` and the same env vars. Without it, receipt emails run in a background thread inside the API.

## Optional: email receipts
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` (for example, a Gmail account with an App Password).

## Optional: PostGIS
If your Postgres has PostGIS (Supabase does; enable it under *Database → Extensions*), set `USE_POSTGIS=true`. The migration creates a GiST geography index, and nearby-driver search uses `ST_DWithin`.

## Production checklist
- `DEMO_BOTS=false` (turns off simulated drivers)
- A strong `JWT_SECRET`
- `CORS_ORIGINS` set to your exact frontend URL
- Stripe webhook secret configured

---

## Alternative: one VM with Docker
On any VPS with Docker (DigitalOcean, AWS EC2, …):
```bash
git clone https://github.com/<you>/gocab.git && cd gocab
# edit docker-compose.yml: set NEXT_PUBLIC_API_URL build arg + CORS_ORIGINS to your domain/IP
docker compose up -d --build
```
