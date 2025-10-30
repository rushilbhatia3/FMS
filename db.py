from contextlib import closing
import sqlite3
from typing import Optional, Sequence, Tuple, Any
DB_PATH = "Database/Database.db"


def get_conn():
    return sqlite3.connect(DB_PATH, check_same_thread=False)

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.row_factory = sqlite3.Row
    return conn

def db_read(sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
    with _connect() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall()


def db_write(sql: str, params: Sequence[Any] = ()) -> int:
    with _connect() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid

def get_settings():
    with closing(get_conn()) as conn, conn:
        cur = conn.execute("SELECT admin_email, reminder_freq_minutes FROM settings WHERE id=1")
        row = cur.fetchone()
        if not row:
            return {"admin_email": "homeofcreativechaos@gmail.com", "reminder_freq_minutes": 180}
        return {"admin_email": row[0], "reminder_freq_minutes": row[1]}

def update_settings(admin_email: str, freq: int):
    with closing(get_conn()) as conn, conn:
        conn.execute("""
            INSERT INTO settings (id, admin_email, reminder_freq_minutes, updated_at)
            VALUES (1, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              admin_email = excluded.admin_email,
              reminder_freq_minutes = excluded.reminder_freq_minutes,
              updated_at = datetime('now')
        """, (admin_email, freq))
        
def find_overdue_checkouts():
    with closing(get_conn()) as conn, conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute("""
            SELECT
              c.id as checkout_id,
              c.file_id,
              c.holder_name,
              c.checkout_at,
              c.due_at,
              f.name as file_name,
              f.system_number,
              f.shelf
            FROM checkout c
            JOIN files f ON f.id = c.file_id
            WHERE c.return_at IS NULL
              AND c.due_at IS NOT NULL
              AND datetime('now') > c.due_at
              AND c.notified_at IS NULL
        """)
        return [dict(r) for r in cur.fetchall()]
    
def mark_checkout_notified(checkout_id: int):
    with closing(get_conn()) as conn, conn:
        conn.execute("UPDATE checkout SET notified_at = datetime('now') WHERE id = ?", (checkout_id,))
