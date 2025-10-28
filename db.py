import sqlite3
from typing import Optional, Sequence, Tuple, Any
DB_PATH = "Database/Database.db"

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
