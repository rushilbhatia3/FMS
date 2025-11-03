from contextlib import closing
import sqlite3
from typing import Dict, List, Optional, Sequence, Tuple, Any
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

def row_to_dict(cur, row):
    return {d[0]: row[i] for i, d in enumerate(cur.description)}

def upsert_location(system_number: Optional[str], shelf: Optional[str]) -> Optional[int]:
    if not system_number and not shelf:
        return None
    c = get_conn()
    c.execute("PRAGMA foreign_keys=ON")
    cur = c.cursor()
    cur.execute("""
      INSERT OR IGNORE INTO locations(system_number, shelf)
      VALUES(?, ?)
    """, (system_number, shelf))
    # If new row inserted, lastrowid is set; otherwise fetch existing id.
    if cur.lastrowid:
        loc_id = cur.lastrowid
    else:
        cur.execute("""
          SELECT id FROM locations WHERE system_number IS ? AND shelf IS ? LIMIT 1
        """, (system_number, shelf))
        r = cur.fetchone()
        loc_id = r[0] if r else None
    c.commit()
    c.close()
    return loc_id

def insert_item(
    name: str,
    tag: Optional[str],
    note: Optional[str],
    clearance_level: Optional[int],
    height_mm: Optional[float],
    width_mm: Optional[float],
    depth_mm: Optional[float],
    location_id: Optional[int],
    added_by: Optional[str],
    sku: Optional[str] = None,
    category: Optional[str] = None,
    unit: Optional[str] = 'units'
) -> int:
    c = get_conn(); c.execute("PRAGMA foreign_keys=ON")
    cur = c.cursor()
    cur.execute("""
      INSERT INTO items(name, tag, note, clearance_level,
                        height_mm, width_mm, depth_mm,
                        location_id, added_by, sku, category, unit)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    """, (name, tag, note, clearance_level,
          height_mm, width_mm, depth_mm,
          location_id, added_by, sku, category, unit))
    item_id = cur.lastrowid
    c.commit(); c.close()
    return item_id

def get_item(item_id: int) -> Optional[Dict[str, Any]]:
    c = conn(); c.row_factory = row_to_dict  # type: ignore
    cur = c.cursor()
    cur.execute("""
      SELECT i.*,
             l.system_number, l.shelf, l.aisle, l.rack, l.bin
      FROM items i
      LEFT JOIN locations l ON l.id = i.location_id
      WHERE i.id = ?
    """, (item_id,))
    row = cur.fetchone()
    c.close()
    return row

def list_items(q: str = "", page: int = 1, page_size: int = 100, include_deleted: bool = False) -> Dict[str, Any]:
    c = conn(); c.row_factory = row_to_dict  # type: ignore
    cur = c.cursor()

    where = []
    args: List[Any] = []
    if q:
        where.append("(i.name LIKE ? OR i.tag LIKE ? OR i.note LIKE ? OR i.sku LIKE ?)")
        args += [f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"]
    if not include_deleted:
        where.append("i.is_deleted = 0")

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    # total
    cur.execute(f"SELECT COUNT(*) AS n FROM items i {where_sql}", args)
    total = cur.fetchone()["n"]

    # page clamp
    page = max(1, int(page))
    page_size = max(1, min(500, int(page_size)))
    offset = (page - 1) * page_size

    cur.execute(f"""
      SELECT i.id, i.name, i.quantity, i.tag, i.note,
             i.height_mm, i.width_mm, i.depth_mm,
             i.clearance_level, i.added_by, i.created_at, i.updated_at, i.is_deleted,
             l.system_number, l.shelf
      FROM items i
      LEFT JOIN locations l ON l.id = i.location_id
      {where_sql}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    """, (*args, page_size, offset))
    items = cur.fetchall()
    c.close()
    return {"items": items, "page": page, "page_size": page_size, "total": total}