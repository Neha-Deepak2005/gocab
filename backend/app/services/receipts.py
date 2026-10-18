"""PDF receipts (fpdf2 – pure Python, no system libraries needed) and email delivery."""
import logging
import smtplib
from email.message import EmailMessage

from fpdf import FPDF

from ..config import settings
from ..models import Driver, Ride
from .maps import BOOKING_FEE, VEHICLES

log = logging.getLogger(__name__)

PURPLE = (124, 58, 237)
PINK = (236, 72, 153)
DARK = (30, 27, 75)
GREY = (107, 114, 128)


def _txt(s: str | None) -> str:
    # core PDF fonts are latin-1 only
    return (s or "").replace("₹", "Rs. ").encode("latin-1", "replace").decode("latin-1")


def build_receipt_pdf(ride: Ride, driver: Driver | None) -> bytes:
    pdf = FPDF(format="A5")
    pdf.set_auto_page_break(True, 12)
    pdf.add_page()
    w = pdf.w

    # header band
    pdf.set_fill_color(*PURPLE)
    pdf.rect(0, 0, w, 34, "F")
    pdf.set_fill_color(*PINK)
    pdf.rect(0, 30, w, 4, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_xy(10, 8)
    pdf.cell(0, 10, "GoCab")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_xy(10, 19)
    pdf.cell(0, 6, f"Ride receipt  #{ride.id}")

    pdf.set_text_color(*DARK)
    pdf.set_xy(10, 42)
    pdf.set_font("Helvetica", "B", 26)
    total = ride.fare_actual if ride.fare_actual is not None else ride.fare_estimate - ride.discount
    pdf.cell(0, 12, _txt(f"₹{total:,.2f}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*GREY)
    when = ride.completed_at or ride.created_at
    pdf.cell(0, 5, _txt(f"{when:%d %b %Y, %I:%M %p} UTC  ·  {ride.status.title()}  ·  Payment: {ride.payment_method.title()} ({ride.payment_status})"),
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    def section(title):
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(*PURPLE)
        pdf.cell(0, 7, title.upper(), new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(*DARK)
        pdf.set_font("Helvetica", "", 10)

    def row(label, value, bold=False):
        pdf.set_font("Helvetica", "B" if bold else "", 10)
        pdf.cell(w - 60, 6, _txt(label))
        pdf.cell(40, 6, _txt(value), align="R", new_x="LMARGIN", new_y="NEXT")

    section("Trip")
    pdf.multi_cell(0, 5, _txt(f"From: {ride.pickup_address or f'{ride.pickup_lat:.5f}, {ride.pickup_lng:.5f}'}"), new_x="LMARGIN", new_y="NEXT")
    pdf.multi_cell(0, 5, _txt(f"To:   {ride.drop_address or f'{ride.drop_lat:.5f}, {ride.drop_lng:.5f}'}"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, _txt(f"{ride.distance_meters/1000:.1f} km  ·  {round(ride.duration_secs/60)} min  ·  {VEHICLES[ride.vehicle_type][0]}"),
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    section("Fare breakdown")
    _, _, base, per_km, per_min, _ = VEHICLES[ride.vehicle_type]
    subtotal = ride.fare_estimate - BOOKING_FEE
    row("Base fare + distance + time", f"₹{subtotal / max(ride.surge, 1):,.2f}")
    if ride.surge > 1:
        row(f"Surge x{ride.surge}", f"₹{subtotal - subtotal / ride.surge:,.2f}")
    row("Booking fee", f"₹{BOOKING_FEE:,.2f}")
    if ride.discount:
        row(f"Promo {ride.promo_code or ''}", f"-₹{ride.discount:,.2f}")
    pdf.set_draw_color(*PINK)
    pdf.line(10, pdf.get_y() + 1, w - 10, pdf.get_y() + 1)
    pdf.ln(3)
    row("Total", f"₹{total:,.2f}", bold=True)
    pdf.ln(3)

    if ride.driver:
        section("Driver")
        veh = f"  ·  {driver.vehicle_color} {driver.vehicle_model} ({driver.vehicle_number})" if driver else ""
        pdf.multi_cell(0, 5, _txt(f"{ride.driver.name}  ·  {ride.driver.rating_avg:.1f}★".replace("★", " stars") + veh),
                       new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

    section("Rider")
    pdf.cell(0, 5, _txt(f"{ride.rider.name}  ·  {ride.rider.email}"), new_x="LMARGIN", new_y="NEXT")

    pdf.set_y(-22)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(*GREY)
    pdf.multi_cell(0, 4, "Thanks for riding with GoCab! Questions about this trip? Reply to the receipt email.", align="C")
    return bytes(pdf.output())


def send_email(to: str, subject: str, html: str, attachment: bytes | None = None, filename: str = "receipt.pdf") -> bool:
    if not settings.SMTP_HOST:
        log.info("[email skipped – SMTP not configured] to=%s subject=%s", to, subject)
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.SMTP_FROM, to, subject
    msg.set_content("Your GoCab receipt is attached.")
    msg.add_alternative(html, subtype="html")
    if attachment:
        msg.add_attachment(attachment, maintype="application", subtype="pdf", filename=filename)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
        s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
        s.send_message(msg)
    return True
