import sqlite3
from pathlib import Path
from typing import Sequence, Any, List

DB_PATH = Path("Database/Database.db")
SCHEMA_PATH = Path("Database/schema.sql")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # PRAGMAs are per-connection in SQLite
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def db_read(sql: str, params: Sequence[Any] = ()) -> List[sqlite3.Row]:
    with _connect() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall()


def db_write(sql: str, params: Sequence[Any] = ()) -> int:
    with _connect() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid


def db_execmany(sql: str, seq_of_params: Sequence[Sequence[Any]]) -> None:
    with _connect() as conn:
        conn.executemany(sql, seq_of_params)
        conn.commit()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with _connect() as conn:
        conn.executescript(schema_sql)
        conn.commit()


# Initialize schema at import if file is empty or missing core tables
def _needs_init() -> bool:
    if not DB_PATH.exists() or DB_PATH.stat().st_size == 0:
        return True
    try:
        rows = db_read("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','items','movements')")
        return len(rows) < 3
    except Exception:
        return True


if _needs_init():
    init_db()
