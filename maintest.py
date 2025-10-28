import csv
from typing import Optional, Sequence, Tuple, Any
import zipfile
from fastapi import FastAPI, HTTPException, status, Path, Body, Query, UploadFile, File
import sqlite3, io, openpyxl
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from maintenance import router as maintenance_router
from db import db_read, db_write

DB_PATH = "Database/Database.db"
app=FastAPI()


#@app.get("/")
def dbTest():
    #sql = "SELECT * FROM files WHERE is_deleted = 0 ORDER BY created_at DESC"
    #r#ows = db_read(sql)
    #return [dict(row) for row in rows]
    
    print(add_file( name= "   Test File",
    size_label= "Optional",
    type_label= "Optional",
    tag= "Non",
    note= "Admin level only",
    system_number= "SYS-001", 
    shelf=  "2b",
    clearance_level=  1,
    added_by= "operator"))

def innitDB():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    conn.execute("PRAGMA foreign_keys = ON;")
    schema=cursor.executescript('''
       CREATE TABLE IF NOT EXISTS files (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          name              TEXT NOT NULL,
          size_label        TEXT,
          type_label        TEXT,
          tag               TEXT,
          note              TEXT,

          system_number     TEXT NOT NULL,
          shelf             TEXT NOT NULL,

          clearance_level   INTEGER NOT NULL CHECK (clearance_level BETWEEN 1 AND 4),

          added_by          TEXT NOT NULL DEFAULT 'operator',
          created_at        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          updated_at        TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          deleted_at        TEXT,
          is_deleted        INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1))
        );

        CREATE INDEX IF NOT EXISTS idx_files_name       ON files(name);
        CREATE INDEX IF NOT EXISTS idx_files_location   ON files(system_number, shelf);
        CREATE INDEX IF NOT EXISTS idx_files_clearance  ON files(clearance_level);
        CREATE INDEX IF NOT EXISTS idx_files_is_deleted ON files(is_deleted);
        CREATE INDEX IF NOT EXISTS idx_files_active_name ON files(is_deleted, name);
        CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);

    
        -- CHECKOUTS (movement log)
   
        CREATE TABLE IF NOT EXISTS checkouts (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id        INTEGER NOT NULL,
          holder_name    TEXT NOT NULL,
          checkout_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          return_at      TEXT,
          operator_name  TEXT NOT NULL DEFAULT 'operator',
          note           TEXT,
          -- Timeline guard: return cannot predate checkout
          CHECK (return_at IS NULL OR return_at >= checkout_at),
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_checkouts_file_return    ON checkouts(file_id, return_at);
        CREATE INDEX IF NOT EXISTS idx_checkouts_checkout_at    ON checkouts(checkout_at);
        CREATE INDEX IF NOT EXISTS idx_checkouts_return_at      ON checkouts(return_at);
        CREATE INDEX IF NOT EXISTS idx_checkouts_file_checkout_at ON checkouts(file_id, checkout_at DESC);


        CREATE UNIQUE INDEX IF NOT EXISTS oneCheckoutPerFile
        ON checkouts(file_id)
        WHERE return_at IS NULL;


        DROP TRIGGER IF EXISTS trg_checkouts_return_after_checkout;
        CREATE TRIGGER IF NOT EXISTS trg_checkouts_return_after_checkout
        BEFORE UPDATE OF return_at ON checkouts
        FOR EACH ROW
        WHEN NEW.return_at IS NOT NULL AND NEW.return_at < NEW.checkout_at
        BEGIN
          SELECT RAISE(ABORT, 'return_at cannot be earlier than checkout_at');
        END;


        -- DERIVED STATUS VIEW

        CREATE VIEW IF NOT EXISTS file_status AS
        SELECT
          f.id AS file_id,
          f.name,
          f.system_number,
          f.shelf,
          f.clearance_level,
          f.is_deleted,
          (
            SELECT c.holder_name
            FROM checkouts c
            WHERE c.file_id = f.id AND c.return_at IS NULL
            ORDER BY c.checkout_at DESC
            LIMIT 1
          ) AS currently_held_by,
          (
            SELECT c.checkout_at
            FROM checkouts c
            WHERE c.file_id = f.id AND c.return_at IS NULL
            ORDER BY c.checkout_at DESC
            LIMIT 1
          ) AS date_of_checkout,
          (
            SELECT c2.checkout_at
            FROM checkouts c2
            WHERE c2.file_id = f.id AND c2.return_at IS NOT NULL
            ORDER BY c2.checkout_at DESC
            LIMIT 1
          ) AS date_of_previous_checkout
        FROM files f;


        -- LAST 10 CHECKOUTS PER FILE (ranked window)

        DROP VIEW IF EXISTS file_last_10_access;
        CREATE VIEW IF NOT EXISTS file_last_10_access AS
        WITH ranked AS (
          SELECT
            c.file_id,
            c.holder_name,
            c.checkout_at,
            ROW_NUMBER() OVER (
              PARTITION BY c.file_id
              ORDER BY c.checkout_at DESC
            ) AS rn
          FROM checkouts c
        )
        SELECT file_id, holder_name, checkout_at
        FROM ranked
        WHERE rn <= 10
        ORDER BY file_id, checkout_at DESC;

        -- SOFT DELETE GUARD

        DROP TRIGGER IF EXISTS trg_filesSoftDeleteBlocksOpenCheckout;
        CREATE TRIGGER IF NOT EXISTS trg_filesSoftDeleteBlocksOpenCheckout
        BEFORE UPDATE OF is_deleted ON files
        FOR EACH ROW
        WHEN NEW.is_deleted = 1
        AND EXISTS (
          SELECT 1 FROM checkouts c
          WHERE c.file_id = NEW.id AND c.return_at IS NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'Cannot soft-delete a file with an open checkout. Return it first.');
        END;
        
    ''')
    print("Database Initialized \n ",schema)
    conn.commit()
    conn.close()


@app.post("/api/add_file")
def add_file(
    name: str = Body(...),
    system_number: str = Body(...),
    shelf: str = Body(...),
    clearance_level: int = Body(..., ge=1, le=4),

    size_label: str | None = Body(None),
    type_label: str | None = Body(None),
    tag: str | None = Body(None),
    note: str | None = Body(None),

    added_by: str = Body("operator"),
):

    clean_name = name.strip() if name else ""
    if not clean_name:
        raise HTTPException(status_code=400, detail="File name cannot be empty.")

    clean_system_number = system_number.strip() if system_number else ""
    clean_shelf = shelf.strip() if shelf else ""
    if not clean_system_number or not clean_shelf:
        raise HTTPException(
            status_code=400,
            detail="System number and shelf are required."
        )

    if clearance_level not in (1, 2, 3, 4):
        raise HTTPException(
            status_code=400,
            detail="Clearance level must be between 1 and 4."
        )

    def _norm(x: str | None) -> str | None:
        if x is None:
            return None
        val = x.strip()
        return val if val != "" else None

    size_label_norm = _norm(size_label)
    type_label_norm = _norm(type_label)
    tag_norm        = _norm(tag)
    note_norm       = _norm(note)
    added_by_norm   = (added_by.strip() or "operator") if added_by is not None else "operator"

    sql = """
        INSERT INTO files (
            name,
            size_label,
            type_label,
            tag,
            note,
            system_number,
            shelf,
            clearance_level,
            added_by,
            created_at,
            updated_at,
            is_deleted,
            deleted_at
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL
        )
    """

    params = (
        clean_name,
        size_label_norm,
        type_label_norm,
        tag_norm,
        note_norm,
        clean_system_number,
        clean_shelf,
        clearance_level,
        added_by_norm,
    )

    try:
        new_id = db_write(sql, params)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB insert failed: {e}")

    return {
        "id": new_id,
        "name": clean_name,
        "system_number": clean_system_number,
        "shelf": clean_shelf,
        "clearance_level": clearance_level,
        "added_by": added_by_norm,
        "status": "created"
    }


@app.get("/api/files")
def list_files(
    include_deleted: bool = Query(False),
    q: str = Query("", alias="q"),
    sort: str = Query("created_at"),
    dir: str = Query("desc"),
    status: Optional[str] = Query(None)
):
    q = q.strip()

    where_clauses = []
    params: list[Any] = []

    # allowlisted sort columns
    allowed_sorts = {
        "name": "LOWER(f.name)",
        "created_at": "f.created_at",
        "updated_at": "f.updated_at",
        "clearance_level": "f.clearance_level",
        "shelf": "f.shelf",
    }

    sort_col = allowed_sorts.get(sort, "f.created_at")
    sort_dir = "ASC" if dir.lower() == "asc" else "DESC"

    #
    # 1. Status logic
    #
    # "available"   -> active (not deleted), not checked out
    # "out"         -> active (not deleted), currently checked out
    # None/other    -> normal mode
    #
    status_mode = False
    if status == "available":
        status_mode = True
        where_clauses.append("f.is_deleted = 0")
        where_clauses.append("fs.currently_held_by IS NULL")

    elif status == "out":
        status_mode = True
        where_clauses.append("f.is_deleted = 0")
        where_clauses.append("fs.currently_held_by IS NOT NULL")

    else:
        # normal mode: respect include_deleted
        if not include_deleted:
            where_clauses.append("f.is_deleted = 0")

    #
    # 2. Search filter
    #
    if q:
        like_param = f"%{q.lower()}%"
        where_clauses.append("""
        (
            LOWER(f.name)                LIKE ?
         OR LOWER(f.tag)                 LIKE ?
         OR LOWER(f.system_number)       LIKE ?
         OR LOWER(f.shelf)               LIKE ?
         OR LOWER(fs.currently_held_by)  LIKE ?
        )
        """)
        params.extend([like_param, like_param, like_param, like_param, like_param])

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    #
    # 3. ORDER BY behavior
    #
    # If we're in status mode (available/out), we bias active "working set"
    # to the top in a predictable way (non-deleted first).
    #
    # Otherwise (normal browsing mode), we do NOT force deleted rows to bottom.
    # We simply sort by the chosen column, so "Show deleted" acts like
    # lifting a filter, not changing the order semantics.
    #
    if status_mode:
        order_sql = f"""
        ORDER BY
          f.is_deleted ASC,
          {sort_col} {sort_dir},
          f.id DESC
        """
    else:
        order_sql = f"""
        ORDER BY
          {sort_col} {sort_dir},
          f.id DESC
        """

    sql = f"""
    SELECT
        f.id                         AS id,
        f.name                       AS name,
        f.system_number              AS system_number,
        f.shelf                      AS shelf,
        f.clearance_level            AS clearance_level,
        f.added_by                   AS added_by,
        f.created_at                 AS created_at,
        f.updated_at                 AS updated_at,
        f.tag                        AS tag,
        f.note                       AS note,
        f.is_deleted                 AS is_deleted,
        f.deleted_at                 AS deleted_at,

        fs.currently_held_by         AS currently_held_by,
        fs.date_of_checkout          AS date_of_checkout,
        fs.date_of_previous_checkout AS date_of_previous_checkout

    FROM files f
    LEFT JOIN file_status fs
      ON fs.file_id = f.id
    {where_sql}
    {order_sql};
    """

    rows = db_read(sql, params)
    return [dict(row) for row in rows]

@app.delete("/api/files/{file_id}")
def soft_delete_file(file_id: int):
    # Existence check
    row = db_read("SELECT id, is_deleted FROM files WHERE id = ?", (file_id,))
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")

    open_co = db_read("""
        SELECT holder_name, checkout_at
        FROM checkouts
        WHERE file_id = ? AND return_at IS NULL
        LIMIT 1
    """, (file_id,))
    if open_co:
        holder, ts = open_co[0]["holder_name"], open_co[0]["checkout_at"]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete: file is currently checked out by {holder} since {ts}."
        )

    # No-op if already deleted
    if row[0]["is_deleted"] == 1:
        deleted = db_read("SELECT deleted_at FROM files WHERE id = ?", (file_id,))
        return {"id": file_id, "deleted": True, "deleted_at": deleted[0]["deleted_at"]}

    # Perform soft delete
    db_write(
        "UPDATE files SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
        (file_id,)
    )
    out = db_read("SELECT deleted_at FROM files WHERE id = ?", (file_id,))
    return {"id": file_id, "deleted": True, "deleted_at": out[0]["deleted_at"]}

# RESTORE
@app.patch("/api/files/{file_id}/restore")
def restore_file(file_id: int):
    row = db_read("SELECT id, is_deleted FROM files WHERE id = ?", (file_id,))
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")

    if row[0]["is_deleted"] == 0:
        return {"id": file_id, "restored": True}

    db_write(
        "UPDATE files SET is_deleted = 0, deleted_at = NULL WHERE id = ?",
        (file_id,)
    )
    return {"id": file_id, "restored": True}

@app.get("/api/deleted_files")
def list_deleted_files():
    sql = """
    SELECT *
    FROM file_status fs
    JOIN files f ON f.id = fs.file_id
    WHERE f.is_deleted = 1;

    """
    return [dict(r) for r in db_read(sql)]


@app.post("/api/files/{file_id}/checkout")
def checkout_file(
    file_id: int,
    holder_name: str = Body(...),
    operator_name: str = Body("operator"),
    note: Optional[str] = Body(None),
):
    #file must exist
    row = db_read(
        "SELECT id, is_deleted FROM files WHERE id = ?",
        (file_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")

    #can't check out a deleted file
    if row[0]["is_deleted"] == 1:
        raise HTTPException(
            status_code=409,
            detail="Cannot check out a deleted file."
        )

    #name must not be empty/whitespace
    if not holder_name.strip():
        raise HTTPException(
            status_code=400,
            detail="holder_name is required."
        )

    #not already be checked out
    open_co = db_read(
        """
        SELECT id FROM checkouts
        WHERE file_id = ? AND return_at IS NULL
        LIMIT 1
        """,
        (file_id,)
    )
    if open_co:
        raise HTTPException(
            status_code=409,
            detail="File is already checked out."
        )

    #create new checkout record
    #checkout_at defaults to CURRENT_TIMESTAMP, return_at defaults to NULL
    checkout_id = db_write(
        """
        INSERT INTO checkouts (file_id, holder_name, operator_name, note)
        VALUES (?, ?, ?, ?)
        """,
        (file_id, holder_name.strip(), operator_name, note)
    )

    return {
        "status": "checked_out",
        "checkout_id": checkout_id,
        "file_id": file_id,
        "holder_name": holder_name.strip()
    }


@app.patch("/api/files/{file_id}/return")
def return_file(
    file_id: int,
    operator_name: str = Body("operator"),
    note: Optional[str] = Body(None),
):
    #active checkout
    row = db_read(
        """
        SELECT id, note
        FROM checkouts
        WHERE file_id = ? AND return_at IS NULL
        ORDER BY checkout_at DESC
        LIMIT 1
        """,
        (file_id,)
    )
    if not row:
        raise HTTPException(
            status_code=409,
            detail="No active checkout to return for this file."
        )

    checkout_id = row[0]["id"]
    prev_note = row[0]["note"]

    #if they added a note on return, we keep it. If not, we keep the old note.
    final_note = note if note is not None else prev_note

    #close
    db_write(
        """
        UPDATE checkouts
        SET return_at = CURRENT_TIMESTAMP,
            operator_name = ?,
            note = ?
        WHERE id = ?
        """,
        (operator_name, final_note, checkout_id)
    )

    return {
        "status": "returned",
        "checkout_id": checkout_id,
        "file_id": file_id
    }


@app.get("/api/files/{file_id}/details")
def file_details(file_id: int):
    # Basic file metadata and live status
    info_rows = db_read(
        """
        SELECT
            f.id,
            f.name,
            f.tag,
            f.note,
            f.size_label,
            f.type_label,
            f.system_number,
            f.shelf,
            f.clearance_level,
            f.added_by,
            f.created_at,
            f.updated_at,
            f.is_deleted,
            f.deleted_at,

            fs.currently_held_by,
            fs.date_of_checkout,
            fs.date_of_previous_checkout
        FROM files f
        LEFT JOIN file_status fs
          ON fs.file_id = f.id
        WHERE f.id = ?
        LIMIT 1;
        """,
        (file_id,)
    )

    if not info_rows:
        raise HTTPException(status_code=404, detail="File not found.")

    info = dict(info_rows[0])

    # Last 10 access history for this file
    history_rows = db_read(
        """
        SELECT
            c.holder_name,
            c.checkout_at,
            c.return_at,
            c.operator_name,
            c.note
        FROM checkouts c
        WHERE c.file_id = ?
        ORDER BY c.checkout_at DESC
        LIMIT 10;
        """,
        (file_id,)
    )

    history = [dict(r) for r in history_rows]

    return {
        "file": info,
        "history": history,
    }


@app.patch("/api/files/{file_id}")
def update_file(
    file_id: int,
    name: str = Body(...),
    size_label: Optional[str] = Body(None),
    type_label: Optional[str] = Body(None),
    tag: Optional[str] = Body(None),
    note: Optional[str] = Body(None),
    system_number: str = Body(...),
    shelf: str = Body(...),
    clearance_level: int = Body(..., ge=1, le=4),
):
    #file exist?
    row = db_read(
        """
        SELECT id, is_deleted
        FROM files
        WHERE id = ?
        """,
        (file_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")


    clean_name = name.strip() if name else ""
    if not clean_name:
        raise HTTPException(status_code=400, detail="File name cannot be empty.")

    clean_system_number = system_number.strip() if system_number else ""
    clean_shelf = shelf.strip() if shelf else ""
    if not clean_system_number or not clean_shelf:
        raise HTTPException(status_code=400, detail="System number and shelf are required.")

    if clearance_level not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="Clearance level must be between 1 and 4.")


    db_write(
        """
        UPDATE files
        SET
            name = ?,
            size_label = ?,
            type_label = ?,
            tag = ?,
            note = ?,
            system_number = ?,
            shelf = ?,
            clearance_level = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            clean_name,
            size_label,
            type_label,
            tag,
            note,
            clean_system_number,
            clean_shelf,
            clearance_level,
            file_id,
        ),
    )

    # return confirmation + echo some of the new values.
    updated = db_read(
        """
        SELECT
            id,
            name,
            size_label,
            type_label,
            tag,
            note,
            system_number,
            shelf,
            clearance_level,
            added_by,
            created_at,
            updated_at,
            is_deleted
        FROM files
        WHERE id = ?
        """,
        (file_id,)
    )[0]

    return {
        "updated": True,
        "file": dict(updated),
    }
    


"""
this is all to read stuff from csv/xlsx and import it in bulk
"""
def _validate_and_normalize_row(row: dict) -> dict:
    name = (row.get("name") or "").strip()
    size_label = (row.get("size_label") or "").strip() or None
    type_label = (row.get("type_label") or "").strip() or None
    tag = (row.get("tag") or "").strip() or None
    note = (row.get("note") or "").strip() or None
    system_number = (row.get("system_number") or "").strip()
    shelf = (row.get("shelf") or "").strip()

    cl_raw = row.get("clearance_level")
    if cl_raw is None or cl_raw == "":
        clearance_level = 1
    else:
        try:
            clearance_level = int(str(cl_raw).strip())
        except ValueError:
            raise ValueError("clearance_level must be an integer")

    added_by = (row.get("added_by") or "operator").strip() or "operator"

    # Business rules
    if not name:
        raise ValueError("File name cannot be empty")
    if not system_number or not shelf:
        raise ValueError("System number and shelf are required")
    if clearance_level not in (1, 2, 3, 4):
        raise ValueError("clearance_level must be between 1 and 4")

    return {
        "name": name,
        "size_label": size_label,
        "type_label": type_label,
        "tag": tag,
        "note": note,
        "system_number": system_number,
        "shelf": shelf,
        "clearance_level": clearance_level,
        "added_by": added_by,
    }


def _rows_from_csv(text: str) -> list[dict]:
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        return []

    rows = []
    for raw in reader:
        # DictReader returns strings for each cell
        rows.append(raw)
    return rows


def _rows_from_xlsx(data: bytes) -> list[dict]:
    if openpyxl is None:
        raise HTTPException(
            status_code=500,
            detail="Excel import not available (openpyxl not installed on server)."
        )

    wb = openpyxl.load_workbook(filename=io.BytesIO(data), read_only=True)
    ws = wb.active  # first sheet

    # Extract rows as lists
    matrix = []
    for row in ws.iter_rows(values_only=True):
        # row is a tuple like ('name', 'size_label', ...)
        # convert None -> "" for consistency
        matrix.append([("" if cell is None else str(cell)).strip() for cell in row])

    # Find header row
    if not matrix:
        return []

    header = matrix[0]
    body = matrix[1:]

    rows = []
    for line in body:
        # Map each header -> cell value (or "")
        row_dict = {}
        for i, key in enumerate(header):
            if key:  # skip completely empty header cells
                row_dict[key] = line[i] if i < len(line) else ""
        rows.append(row_dict)

    return rows


@app.post("/api/import_file")
def import_file(file: UploadFile = File(...)):
    filename = (file.filename or "").lower()
    # Read raw bytes
    try:
        raw_bytes = file.file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read uploaded file")

    # Decide how to parse
    rows_raw: list[dict]
    if filename.endswith(".csv"):
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
        except Exception:
            raise HTTPException(status_code=400, detail="File is not valid UTF-8 text")
        rows_raw = _rows_from_csv(text)

    elif filename.endswith(".xlsx"):
        rows_raw = _rows_from_xlsx(raw_bytes)

    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload .csv or .xlsx"
        )

    if not rows_raw:
        return {
            "imported": 0,
            "failed": 0,
            "errors": ["No rows detected in file."]
        }

    # We'll do a single transaction for speed.
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")

    inserted = 0
    failed = 0
    errors: list[dict] = []

    try:
        cur = conn.cursor()
        for idx, raw_row in enumerate(rows_raw, start=2):  # row 2 == first data row
            try:
                cleaned = _validate_and_normalize_row(raw_row)

                cur.execute(
                    """
                    INSERT INTO files
                    (name, size_label, type_label, tag, note,
                     system_number, shelf, clearance_level, added_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cleaned["name"],
                        cleaned["size_label"],
                        cleaned["type_label"],
                        cleaned["tag"],
                        cleaned["note"],
                        cleaned["system_number"],
                        cleaned["shelf"],
                        cleaned["clearance_level"],
                        cleaned["added_by"],
                    ),
                )
                inserted += 1

            except Exception as e:
                failed += 1
                errors.append({
                    "row": idx,
                    "error": str(e),
                    "data": raw_row
                })

        conn.commit()

    finally:
        conn.close()

    return {
        "imported": inserted,
        "failed": failed,
        "errors": errors[:10],  # cap the error dump for response size
    }


#export file logic

def _export_files_csv() -> io.StringIO:
    sql = """
    SELECT
        id,
        name,
        size_label,
        type_label,
        tag,
        note,
        system_number,
        shelf,
        clearance_level,
        added_by,
        created_at,
        updated_at,
        is_deleted,
        deleted_at
    FROM files
    ORDER BY created_at DESC
    """
    rows = db_read(sql)

    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow([
        "id",
        "name",
        "size_label",
        "type_label",
        "tag",
        "note",
        "system_number",
        "shelf",
        "clearance_level",
        "added_by",
        "created_at",
        "updated_at",
        "is_deleted",
        "deleted_at"
    ])

    for r in rows:
        writer.writerow([
            r["id"],
            r["name"],
            r["size_label"],
            r["type_label"],
            r["tag"],
            r["note"],
            r["system_number"],
            r["shelf"],
            r["clearance_level"],
            r["added_by"],
            r["created_at"],
            r["updated_at"],
            r["is_deleted"],
            r["deleted_at"],
        ])

    buf.seek(0)
    return buf

def _export_checkouts_csv() -> io.StringIO:
    sql = """
    SELECT
        id,
        file_id,
        holder_name,
        checkout_at,
        return_at,
        operator_name,
        note
    FROM checkouts
    ORDER BY checkout_at DESC
    """
    rows = db_read(sql)

    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow([
        "id",
        "file_id",
        "holder_name",
        "checkout_at",
        "return_at",
        "operator_name",
        "note"
    ])

    for r in rows:
        writer.writerow([
            r["id"],
            r["file_id"],
            r["holder_name"],
            r["checkout_at"],
            r["return_at"],
            r["operator_name"],
            r["note"],
        ])

    buf.seek(0)
    return buf

@app.get("/api/export")
def export_data(export_type: str = Query("all", alias="type")):
    export_type = export_type.lower().strip()

    # 1) files only
    if export_type == "files":
        files_buf = _export_files_csv()
        return StreamingResponse(
            files_buf,
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="files_export.csv"'
            },
        )

    # 2) checkouts only
    elif export_type == "checkouts":
        checkouts_buf = _export_checkouts_csv()
        return StreamingResponse(
            checkouts_buf,
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="checkouts_export.csv"'
            },
        )

    # 3) everything -> zip
    elif export_type == "all":
        # build both CSVs in memory
        files_buf = _export_files_csv()
        checkouts_buf = _export_checkouts_csv()

        # now create an in-memory ZIP archive
        zip_bytes = io.BytesIO()
        with zipfile.ZipFile(zip_bytes, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("files_export.csv", files_buf.getvalue())
            zf.writestr("checkouts_export.csv", checkouts_buf.getvalue())

        zip_bytes.seek(0)

        return StreamingResponse(
            zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="fms_backup.zip"'
            },
        )

    else:
        raise HTTPException(status_code=400, detail="Invalid export type. Use files, checkouts, or all.")

innitDB()
app.mount("/app", StaticFiles(directory="/Users/rushilb/Desktop/DBMS/FrontEnd", html=True), name="FrontEnd")

app.include_router(maintenance_router)