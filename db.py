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
    # IMPORTANT: use =, not IS
    cur.execute("""
      SELECT id FROM locations WHERE system_number = ? AND shelf = ? LIMIT 1
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

def get_item(item_id: int) -> Dict[str, Any] | None:
    with _connect() as c:
        cur = c.cursor()
        cur.execute("""
          WITH last_move AS (
            SELECT m.item_id, m.movement_type, m.operator_name, m.timestamp AS last_movement_ts
            FROM movements m
            JOIN (
              SELECT item_id, MAX(timestamp) AS ts FROM movements GROUP BY item_id
            ) t ON t.item_id = m.item_id AND t.ts = m.timestamp
          )
          SELECT i.*, l.system_number, l.shelf,
                 lm.movement_type, lm.operator_name AS currently_held_by, lm.last_movement_ts
          FROM items i
          LEFT JOIN locations l ON l.id = i.location_id
          LEFT JOIN last_move lm ON lm.item_id = i.id
          WHERE i.id = ?
          LIMIT 1
        """, (item_id,))
        r = cur.fetchone()
        return dict(r) if r else None

        
def insert_movement(*, item_id:int, movement_type:str, quantity:int, operator_name:str|None=None, note:str|None=None):
    mt = movement_type.lower().strip()
    if mt not in ("in","out"): raise ValueError("movement_type must be 'in' or 'out'")
    qty = int(quantity) 
    if qty <= 0: raise ValueError("quantity must be > 0")

    with _connect() as c:
        cur = c.cursor()

        cur.execute("SELECT is_deleted, quantity FROM items WHERE id=?",(item_id,))
        row = cur.fetchone()
        if not row: raise ValueError("item does not exist")
        if int(row["is_deleted"]) == 1: raise ValueError("cannot move an archived item")

        delta = qty if mt == "in" else -qty
        if int(row["quantity"] or 0) + delta < 0:
            raise ValueError(f"insufficient stock: current={row['quantity']}, requested out={qty}")

        # store signed amount; trigger will add NEW.quantity
        cur.execute("""
            INSERT INTO movements(item_id, movement_type, quantity, operator_name, note)
            VALUES (?,?,?,?,?)
        """, (item_id, mt, delta, operator_name, note))

        # NO manual UPDATE here when using the trigger
        # updated_at courtesy update:
        cur.execute("UPDATE items SET updated_at = datetime('now') WHERE id = ?", (item_id,))
     

def list_items(q: str = "", page: int = 1, page_size: int = 100,
               include_deleted: bool = False, sort: str = "created_at", dir: str = "desc") -> Dict[str, Any]:
    c = _connect(); c.row_factory = sqlite3.Row
    cur = c.cursor()

    where, args = [], []
    if q:
        where.append("(i.name LIKE ? OR i.tag LIKE ? OR i.note LIKE ? OR i.sku LIKE ?)")
        args += [f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"]
    if not include_deleted:
        where.append("i.is_deleted = 0")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    # sanitize sort
    allowed = {
        "name": "i.name", "created_at": "i.created_at", "updated_at": "i.updated_at",
        "quantity": "i.quantity", "system_number": "l.system_number", "shelf": "l.shelf"
    }
    order_col = allowed.get(sort, "i.created_at")
    order_dir = "ASC" if str(dir).lower() == "asc" else "DESC"

    cur.execute(f"SELECT COUNT(*) AS n FROM items i LEFT JOIN locations l ON l.id=i.location_id {where_sql}", args)
    total = cur.fetchone()["n"]

    page = max(1, int(page)); page_size = max(1, min(500, int(page_size)))
    offset = (page - 1) * page_size

    cur.execute(f"""
      SELECT i.id, i.name, i.quantity, i.tag, i.note,
             i.height_mm, i.width_mm, i.depth_mm,
             i.clearance_level, i.added_by, i.created_at, i.updated_at, i.is_deleted,
             l.system_number, l.shelf
      FROM items i
      LEFT JOIN locations l ON l.id = i.location_id
      {where_sql}
      ORDER BY {order_col} {order_dir}
      LIMIT ? OFFSET ?
    """, (*args, page_size, offset))
    rows = cur.fetchall(); c.close()
    return {"items": [dict(r) for r in rows], "page": page, "page_size": page_size, "total": total}


def items_stats(include_deleted: bool = True) -> dict:
    c = _connect()
    cur = c.cursor()
    if include_deleted:
        cur.execute("SELECT COUNT(*) FROM items")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM items WHERE is_deleted = 0")
        active = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM items WHERE is_deleted = 1")
        archived = cur.fetchone()[0]
    else:
        cur.execute("SELECT COUNT(*) FROM items WHERE is_deleted = 0")
        active = cur.fetchone()[0]
        total = active
        archived = None
    c.close()
    return {"active_count": active, "archived_count": archived, "total_count": total}


def update_item(item_id:int,
                name:Optional[str]=None,
                tag:Optional[str]=None,
                note:Optional[str]=None,
                clearance_level:Optional[int]=None,
                height_mm:Optional[float]=None,
                width_mm:Optional[float]=None,
                depth_mm:Optional[float]=None,
                location_id:Optional[int]=None):
    c = _connect()
    cur = c.cursor()
    sets, args = [], []
    if name is not None:             sets.append("name = ?");             args.append(name)
    if tag is not None:              sets.append("tag = ?");              args.append(tag)
    if note is not None:             sets.append("note = ?");             args.append(note)
    if clearance_level is not None:  sets.append("clearance_level = ?");  args.append(clearance_level)
    if height_mm is not None:        sets.append("height_mm = ?");        args.append(height_mm)
    if width_mm is not None:         sets.append("width_mm = ?");         args.append(width_mm)
    if depth_mm is not None:         sets.append("depth_mm = ?");         args.append(depth_mm)
    if location_id is not None:      sets.append("location_id = ?");      args.append(location_id)
    if not sets:
        c.close(); return
    sets.append("updated_at = datetime('now')")
    sql = f"UPDATE items SET {', '.join(sets)} WHERE id = ?"
    args.append(item_id)
    cur.execute(sql, args)
    c.commit()
    c.close()
    
def list_items(q: str = "", page: int = 1, page_size: int = 100,
               include_deleted: bool = False, sort: str = "created_at",
               dir: str = "desc", status: str = "") -> Dict[str, Any]:
    c = _connect(); c.row_factory = sqlite3.Row
    cur = c.cursor()

    # --- build WHERE ---
    where, args = [], []

    if q:
        like = f"%{q}%"
        where.append("(i.name LIKE ? OR i.tag LIKE ? OR i.note LIKE ? OR i.sku LIKE ?)")
        args += [like, like, like, like]

    if not include_deleted:
        where.append("i.is_deleted = 0")

    # status accepts: '', 'available'/'in_stock', 'out'/'out_of_stock'
    s = (status or "").lower().strip()
    status_sql = ""
    if s in ("available", "in_stock", "in stock"):
        status_sql = "AND (lm.movement_type IS NULL OR lm.movement_type <> 'out')"
    elif s in ("out", "out_of_stock", "out of stock", "checked_out", "checked-out", "checked out"):
        status_sql = "AND (lm.movement_type = 'out')"

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    # --- sort whitelist ---
    allowed = {
        "name": "i.name COLLATE NOCASE",
        "created_at": "i.created_at",
        "updated_at": "i.updated_at",
        "quantity": "i.quantity",
        "clearance_level": "(i.clearance_level + 0)",                  # numeric
        "system_number": "l.system_number COLLATE NOCASE",
        "shelf": "l.shelf COLLATE NOCASE",
        "location": "l.system_number COLLATE NOCASE, l.shelf COLLATE NOCASE",
        "last_movement_ts": "lm.last_movement_ts",
    }
    order_col = allowed.get(sort, "i.created_at")
    order_dir = "ASC" if str(dir).lower() == "asc" else "DESC"

    # --- last movement CTE for status + timestamps + holder name ---
    last_move_cte = """
      WITH last_move AS (
        SELECT m.item_id,
               m.movement_type,
               m.operator_name,
               m.timestamp AS last_movement_ts
        FROM movements m
        JOIN (
          SELECT item_id, MAX(timestamp) AS ts
          FROM movements
          GROUP BY item_id
        ) t ON t.item_id = m.item_id AND t.ts = m.timestamp
      )
    """

    # --- count ---
    cur.execute(f"""
      {last_move_cte}
      SELECT COUNT(*) AS n
      FROM items i
      LEFT JOIN locations l ON l.id = i.location_id
      LEFT JOIN last_move lm ON lm.item_id = i.id
      {where_sql} {status_sql}
    """, args)
    total = cur.fetchone()["n"]

    # --- paging ---
    page = max(1, int(page))
    page_size = max(1, min(500, int(page_size)))
    offset = (page - 1) * page_size

    # --- data ---
    cur.execute(f"""
      {last_move_cte}
      SELECT
        i.id, i.sku, i.name, i.category, i.unit, i.quantity,
        i.tag, i.note, i.height_mm, i.width_mm, i.depth_mm,
        i.clearance_level, i.added_by, i.created_at, i.updated_at, i.is_deleted,
        l.system_number, l.shelf,
        lm.movement_type,
        lm.operator_name AS currently_held_by,
        lm.last_movement_ts
      FROM items i
      LEFT JOIN locations l ON l.id = i.location_id
      LEFT JOIN last_move lm ON lm.item_id = i.id
      {where_sql} {status_sql}
      ORDER BY {order_col} {order_dir}, i.id DESC
      LIMIT ? OFFSET ?
    """, (*args, page_size, offset))
    rows = cur.fetchall()
    c.close()

    return {
        "items": [dict(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
    }
    
def list_movements(item_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    with _connect() as c:
        cur = c.cursor()
        cur.execute("""
            SELECT id, item_id, movement_type, quantity, operator_name, note, timestamp
            FROM movements
            WHERE item_id = ?
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
        """, (item_id, max(1, min(500, int(limit)))))
        return [dict(r) for r in cur.fetchall()]