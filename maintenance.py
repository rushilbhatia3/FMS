import csv
import io
from typing import Any, Dict, List, Tuple, Optional

from fastapi import APIRouter, UploadFile, File, HTTPException
from starlette import status

from db import db_read, db_write  # we'll pull from db.py

router = APIRouter()


def _row_to_record(row: Dict[str, str]) -> Dict[str, Any]:
    def clean(x: Optional[str]) -> Optional[str]:
        if x is None:
            return None
        x2 = x.strip()
        return x2 if x2 != "" else None

    rec = {
        "id":              row.get("id"),
        "name":            clean(row.get("name")),
        "size_label":      clean(row.get("size_label")),
        "type_label":      clean(row.get("type_label")),
        "tag":             clean(row.get("tag")),
        "note":            clean(row.get("note")),
        "system_number":   clean(row.get("system_number")),
        "shelf":           clean(row.get("shelf")),
        "clearance_level": row.get("clearance_level"),
        "added_by":        clean(row.get("added_by")) or "admin",
        "created_at":      clean(row.get("created_at")),
        "updated_at":      clean(row.get("updated_at")),
        "is_deleted":      row.get("is_deleted"),
        "deleted_at":      clean(row.get("deleted_at")),
    }

    # Convert numeric-ish fields
    if rec["id"] is not None and rec["id"] != "":
        rec["id"] = int(rec["id"])

    if rec["clearance_level"] is not None and rec["clearance_level"] != "":
        rec["clearance_level"] = int(rec["clearance_level"])
    else:
        rec["clearance_level"] = 1  # default safety

    if rec["is_deleted"] is not None and rec["is_deleted"] != "":
        rec["is_deleted"] = int(rec["is_deleted"])
    else:
        rec["is_deleted"] = 0

    return rec


def _file_exists(file_id: int) -> bool:
    rows = db_read("SELECT id FROM files WHERE id = ?", (file_id,))
    return bool(rows)


def _update_existing(rec: Dict[str, Any]) -> None:
    """
    Update an existing row in files.
    We DO NOT override created_at.
    We DO override everything else, and we bump updated_at to CURRENT_TIMESTAMP
    because this sync = a write in today's system.
    """
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
            added_by = ?,
            is_deleted = ?,
            deleted_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            rec["name"],
            rec["size_label"],
            rec["type_label"],
            rec["tag"],
            rec["note"],
            rec["system_number"],
            rec["shelf"],
            rec["clearance_level"],
            rec["added_by"],
            rec["is_deleted"],
            rec["deleted_at"],
            rec["id"],
        ),
    )


def _insert_new(rec: Dict[str, Any]) -> None:
    """
    Insert a new row with explicit id (to preserve numbering).
    We try to restore created_at / updated_at from the CSV.
    If they're missing, we fall back to CURRENT_TIMESTAMP.
    """
    # We'll prefer CSV timestamps if present, else use CURRENT_TIMESTAMP.
    created_val = rec["created_at"] if rec["created_at"] else None
    updated_val = rec["updated_at"] if rec["updated_at"] else None

    # We'll generate the right SQL depending on whether we have timestamps.
    # Simpler way: if either timestamp is missing, just let DB fill defaults.
    if created_val and updated_val:
        # Full restore path, including provided timestamps
        db_write(
            """
            INSERT INTO files (
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec["id"],
                rec["name"],
                rec["size_label"],
                rec["type_label"],
                rec["tag"],
                rec["note"],
                rec["system_number"],
                rec["shelf"],
                rec["clearance_level"],
                rec["added_by"],
                rec["created_at"],
                rec["updated_at"],
                rec["is_deleted"],
                rec["deleted_at"],
            ),
        )
    else:
        # Let DB assign timestamps with CURRENT_TIMESTAMP
        db_write(
            """
            INSERT INTO files (
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
                is_deleted,
                deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec["id"],
                rec["name"],
                rec["size_label"],
                rec["type_label"],
                rec["tag"],
                rec["note"],
                rec["system_number"],
                rec["shelf"],
                rec["clearance_level"],
                rec["added_by"],
                rec["is_deleted"],
                rec["deleted_at"],
            ),
        )


def restore_from_csv(file_obj: io.TextIOBase) -> Dict[str, Any]:
    """
    Core restore function.
    Reads a CSV (matching /api/export format) and does upsert-by-id into `files`.
    Returns summary stats you can show in UI.
    """

    reader = csv.DictReader(file_obj)
    inserted = 0
    updated = 0
    failed = 0
    errors: List[Dict[str, Any]] = []

    for idx, row in enumerate(reader, start=2):
        # start=2 because row 1 is headers in CSV
        try:
            rec = _row_to_record(row)

            # Basic validation for required fields.
            # If we can't even construct a valid row, we bail on just this row.
            if not rec["name"]:
                raise ValueError("Missing name")
            if not rec["system_number"] or not rec["shelf"]:
                raise ValueError("Missing physical location (system_number / shelf)")
            if rec["clearance_level"] not in (1, 2, 3, 4):
                raise ValueError("Invalid clearance_level")

            file_id = rec["id"]
            if file_id is None:
                raise ValueError("Missing id in CSV row")

            if _file_exists(file_id):
                _update_existing(rec)
                updated += 1
            else:
                _insert_new(rec)
                inserted += 1

        except Exception as e:
            failed += 1
            errors.append({
                "row": idx,
                "error": str(e),
            })

    return {
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
        "errors": errors[:10],  # cap noise
    }


@router.post("/api/restore_catalog")
async def restore_catalog_endpoint(
    file: UploadFile = File(...)
):
    """
    DEV-ONLY endpoint.
    You send the CSV you got from /api/export.
    We upsert rows into `files`.
    """
    # read uploaded file body as text
    raw_bytes = await file.read()
    try:
        text_stream = io.StringIO(raw_bytes.decode("utf-8"))
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be UTF-8 CSV export.",
        )

    summary = restore_from_csv(text_stream)
    return summary


    """
    curl -X POST \
  -F "file=@files_export.csv" \
  http://127.0.0.1:8000/api/restore_catalog
  
  or 
  python3 -c "import maintenance; f=open('backup.csv','r',encoding='utf-8'); print(maintenance.restore_from_csv(f))"
  we are doing this one
  
    """
    
    
def _checkout_row_to_record(row: Dict[str, str]) -> Dict[str, Any]:
    """
    Convert a raw checkouts CSV row (strings) into typed fields we can insert.
    Expected columns:
      id,
      file_id,
      holder_name,
      checkout_at,
      return_at,
      operator_name,
      note
    """
    def clean(x: Optional[str]) -> Optional[str]:
        if x is None:
            return None
        x2 = x.strip()
        return x2 if x2 != "" else None

    # required-ish
    file_id_raw = row.get("file_id")
    holder_raw = row.get("holder_name")

    rec = {
        "id":              row.get("id"),  # may be blank or None
        "file_id":         int(file_id_raw) if file_id_raw else None,
        "holder_name":     clean(holder_raw),
        "checkout_at":     clean(row.get("checkout_at")),
        "return_at":       clean(row.get("return_at")),
        "operator_name":   clean(row.get("operator_name")) or "admin",
        "note":            clean(row.get("note")),
    }

    # coerce optional id
    if rec["id"] is not None and rec["id"] != "":
        rec["id"] = int(rec["id"])
    else:
        rec["id"] = None

    return rec


def _file_exists_by_id(file_id: int) -> bool:
    """
    Lightweight existence check for `files` table by id.
    We already have _file_exists(file_id) above, but in case you want
    a semantically different name for clarity here, reuse or alias it.
    """
    rows = db_read("SELECT id FROM files WHERE id = ?", (file_id,))
    return bool(rows)


def _insert_checkout_record(rec: Dict[str, Any]) -> None:
    """
    Insert one checkout row.
    Strategy:
      1. If rec["id"] is provided, try to insert with that exact id.
      2. If that violates UNIQUE (id already exists), retry insert
         without forcing the id so SQLite auto-generates a new one.

    We preserve checkout_at / return_at timestamps from CSV.
    """

    def _do_forced_insert():
        return db_write(
            """
            INSERT INTO checkouts (
                id,
                file_id,
                holder_name,
                checkout_at,
                return_at,
                operator_name,
                note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec["id"],
                rec["file_id"],
                rec["holder_name"],
                rec["checkout_at"],
                rec["return_at"],
                rec["operator_name"],
                rec["note"],
            ),
        )

    def _do_auto_insert():
        return db_write(
            """
            INSERT INTO checkouts (
                file_id,
                holder_name,
                checkout_at,
                return_at,
                operator_name,
                note
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                rec["file_id"],
                rec["holder_name"],
                rec["checkout_at"],
                rec["return_at"],
                rec["operator_name"],
                rec["note"],
            ),
        )

    # Case 1: caller didn't give an id at all -> just auto insert
    if rec["id"] is None:
        _do_auto_insert()
        return

    # Case 2: caller DID give an id. try with that id first.
    try:
        _do_forced_insert()
    except Exception as e:
        # If it fails because the id is taken, fall back to auto insert
        msg = str(e)
        if "UNIQUE constraint failed: checkouts.id" in msg:
            _do_auto_insert()
        else:
            # If it's some other DB error, re-raise.
            raise


def restore_checkouts_from_csv(file_obj: io.TextIOBase) -> Dict[str, Any]:
    """
    Bulk-restore / bulk-load checkouts from a CSV dump.

    For each row:
      - we parse fields
      - we validate the basics
      - we insert a new row in `checkouts`

    We do NOT try to "update if exists". We always insert.
    Rationale: checkout log is historical, append-only.
    You wouldn't usually rewrite it; you just replay the events.

    Returns summary:
      {
        "inserted": N,
        "failed": M,
        "errors": [ {row: <csv row#>, error: "msg"}, ... up to 10 ]
      }
    """

    reader = csv.DictReader(file_obj)

    inserted = 0
    failed = 0
    errors: List[Dict[str, Any]] = []

    for idx, row in enumerate(reader, start=2):
        try:
            rec = _checkout_row_to_record(row)

            # --- Basic validation ---
            # file_id and holder_name are required to make sense
            if rec["file_id"] is None:
                raise ValueError("Missing file_id")
            if not rec["holder_name"]:
                raise ValueError("Missing holder_name")

            # The file must actually exist in `files` first,
            # otherwise this checkout row would violate FK.
            if not _file_exists_by_id(rec["file_id"]):
                raise ValueError(
                    f"Referenced file_id {rec['file_id']} does not exist in `files`"
                )

            # If both checkout_at and return_at exist, make sure order is valid
            if rec["checkout_at"] and rec["return_at"]:
                # string compare won't always work safely, so let's do a timestamp parse check
                # We'll do a best-effort lexical check first (cheap, prevents obvious nonsense)
                if rec["return_at"] < rec["checkout_at"]:
                    # (This doesn't handle time zones, but matches same logic as DB trigger:
                    #  return_at can't be before checkout_at.)
                    raise ValueError("return_at is earlier than checkout_at")

            # Insert into DB
            _insert_checkout_record(rec)
            inserted += 1

        except Exception as e:
            failed += 1
            errors.append({
                "row": idx,
                "error": str(e),
            })

    return {
        "inserted": inserted,
        "failed": failed,
        "errors": errors[:10],
    }