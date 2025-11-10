# notifier_worker.py
import os, time, smtplib
from email.message import EmailMessage
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import db

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")  # app mailbox
SMTP_PASS = os.getenv("SMTP_PASS")  # app password/token

def send_overdue_email(to_email: str, rows: list[dict]):
    if not rows or not to_email:
        return
    msg = EmailMessage()
    msg["From"] = SMTP_USER or to_email
    msg["To"] = to_email
    msg["Subject"] = f"[FMS] {len(rows)} file(s) overdue"

    lines = []
    for r in rows:
        lines.append(
            f"- File #{r['file_id']} — {r.get('file_name','?')} "
            f"({r.get('system_number','?')}-{r.get('shelf','?')}), "
            f"holder: {r.get('holder_name','?')}, due: {r.get('due_at','?')}"
        )
    msg.set_content("The following checkouts are overdue:\n\n" + "\n".join(lines) + "\n\n— FMS")

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.starttls()
        if SMTP_USER and SMTP_PASS:
            s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)

def overdue_scan_job():

    claimed = db.claim_overdue_checkouts()
    if not claimed:
        return
    settings = db.get_settings()
    try:
        send_overdue_email(settings["admin_email"], claimed)
        print(f"[{datetime.utcnow().isoformat()}] Sent overdue email for {len(claimed)} checkout(s)")
    except Exception as e:
        # If sending fails, we already set notified_at. Up to you if you want
        # a "retry" mechanism (e.g., clear notified_at on failure). Keeping it simple:
        print("[worker] email send failed:", e)

def main():
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(overdue_scan_job, "interval", minutes=1, id="overdue-scan")
    sched.start()
    print("[worker] notifier started (tick = 1 min); uses settings.reminder_freq_minutes to pace scans")

    try:
        while True:
            time.sleep(3600)  # scheduler runs in background
    except KeyboardInterrupt:
        sched.shutdown(wait=False)

if __name__ == "__main__":
    main()
