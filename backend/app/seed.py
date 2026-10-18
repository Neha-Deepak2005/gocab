"""Seed demo data: demo rider/driver accounts, promo codes and simulated bot drivers.
Run:  python -m app.seed   (also runs automatically on startup; it is idempotent)
"""
import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .config import settings
from .database import SessionLocal
from .models import Driver, Promo, Role, User, WalletTransaction
from .security import hash_password

CITY = (12.9716, 77.5946)  # Bengaluru – bots are relocated near riders anywhere in demo mode

PROMOS = [
    ("WELCOME50", "50% off your first rides (max ₹100)", "percent", 50, 100, 0),
    ("GOCAB20", "20% off any ride (max ₹75)", "percent", 20, 75, 0),
    ("FLAT40", "Flat ₹40 off rides above ₹150", "flat", 40, None, 150),
    ("WEEKEND", "30% off weekend rides (max ₹120)", "percent", 30, 120, 100),
]

BOT_NAMES = ["Ravi Kumar", "Suresh M", "Anita Rao", "Imran Khan", "Priya S", "Vikram Singh", "Arjun N",
             "Kavya R", "Manoj P", "Deepak J", "Fatima Z", "Rahul D", "Sneha K", "Ajay T", "Lakshmi V",
             "Naveen G", "Pooja B", "Karthik L", "Meera H", "Sanjay C"]
VEHICLES = {
    "bike": [("Honda Activa", "Black"), ("TVS Jupiter", "Blue")],
    "auto": [("Bajaj RE", "Yellow-Green"), ("Piaggio Ape", "Yellow")],
    "mini": [("Maruti WagonR", "White"), ("Hyundai i10", "Silver")],
    "sedan": [("Honda City", "Grey"), ("Maruti Dzire", "White")],
    "suv": [("Toyota Innova", "White"), ("Mahindra XUV700", "Black")],
}


def seed() -> None:
    with SessionLocal() as db:
        for code, desc, typ, val, mx, mn in PROMOS:
            if not db.scalar(select(Promo).where(Promo.code == code)):
                db.add(Promo(code=code, description=desc, discount_type=typ, value=val, max_discount=mx, min_fare=mn,
                             expires_at=datetime.now(timezone.utc) + timedelta(days=365)))

        if not db.scalar(select(User).where(User.email == "rider@gocab.app")):
            rider = User(name="Demo Rider", email="rider@gocab.app", phone="+91 90000 00001", role=Role.RIDER,
                         password_hash=hash_password("demo1234"), wallet_balance=500)
            db.add(rider)
            db.flush()
            db.add(WalletTransaction(user_id=rider.id, amount=500, kind="bonus", description="Demo wallet credit"))
        if not db.scalar(select(User).where(User.email == "driver@gocab.app")):
            du = User(name="Demo Driver", email="driver@gocab.app", phone="+91 90000 00002", role=Role.DRIVER,
                      password_hash=hash_password("demo1234"), rating_avg=4.9)
            db.add(du)
            db.flush()
            db.add(Driver(user_id=du.id, vehicle_type="mini", vehicle_model="Maruti Swift", vehicle_number="KA01AB1234",
                          vehicle_color="Red", verified=True, lat=CITY[0], lng=CITY[1], status="offline"))

        if settings.DEMO_BOTS:
            existing = db.scalar(select(User).where(User.email.like("bot%@gocab.bot")))
            if not existing:
                rnd = random.Random(42)
                types = list(VEHICLES)
                for i, name in enumerate(BOT_NAMES):
                    vt = types[i % len(types)]
                    model, color = rnd.choice(VEHICLES[vt])
                    u = User(name=name, email=f"bot{i}@gocab.bot", role=Role.DRIVER, phone=f"+91 98{rnd.randint(10000000, 99999999)}",
                             rating_avg=round(rnd.uniform(4.5, 5.0), 2), rating_count=rnd.randint(40, 900))
                    db.add(u)
                    db.flush()
                    r, a = rnd.uniform(300, 4000), rnd.uniform(0, 2 * math.pi)
                    db.add(Driver(user_id=u.id, vehicle_type=vt, vehicle_model=model, vehicle_color=color,
                                  vehicle_number=f"KA{rnd.randint(1, 53):02d}{rnd.choice('ABCDEFMN')}{rnd.choice('ABCDEFMN')}{rnd.randint(1000, 9999)}",
                                  verified=True, is_bot=True, status="online",
                                  lat=CITY[0] + r * math.cos(a) / 111_000, lng=CITY[1] + r * math.sin(a) / 108_000))
            else:
                # free bots that were mid-trip when the server restarted
                for d in db.scalars(select(Driver).where(Driver.is_bot.is_(True), Driver.status != "online")):
                    d.status = "online"
        db.commit()


if __name__ == "__main__":
    seed()
    print("Seeded ✔")
