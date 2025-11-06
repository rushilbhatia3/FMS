# shelves.py
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from typing import Optional, List

import db
from auth import get_current_user, require_admin

router = APIRouter(tags=["shelves"])


class ShelfIn(BaseModel):
    system_id: int
    label: str
    length_mm: int
    width_mm: int
    height_mm: int
    ordinal: Optional[int] = 1

    @field_validator("label")
    @classmethod
    def label_trim(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("label required")
        return v.strip()


class ShelfOut(BaseModel):
    id: int
    system_id: int
    label: str
    length_mm: int
    width_mm: int
    height_mm: int
    ordinal: int
    is_deleted: int
    created_at: str
    updated_at: str


@router.get("/shelves", response_model=List[ShelfOut])
def list_shelves(
    system_id: Optional[int] = Query(None),
    include_deleted: bool = Query(False),
    _user=Depends(get_current_user),
):
    sql = """
    SELECT id, system_id, label, length_mm, width_mm, height_mm, ordinal,
           is_deleted, created_at, updated_at
    FROM shelves
    WHERE (? = 1 OR is_deleted = 0)
    """
    params = [1 if include_deleted else 0]
    if system_id is not None:
        sql += " AND system_id = ?"
        params.append(system_id)
    sql += " ORDER BY system_id, ordinal"
    rows = db.db_read(sql, params)
    return [dict(r) for r in rows]


@router.get("/shelves/{shelf_id}", response_model=ShelfOut)
def get_shelf(shelf_id: int, _user=Depends(get_current_user)):
    rows = db.db_read(
        """
        SELECT id, system_id, label, length_mm, width_mm, height_mm, ordinal,
               is_deleted, created_at, updated_at
        FROM shelves WHERE id = ?
        """,
        (shelf_id,),
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")
    return dict(rows[0])


@router.post("/shelves", response_model=ShelfOut, status_code=201, dependencies=[Depends(require_admin)])
def create_shelf(payload: ShelfIn):
    sys_exists = db.db_read("SELECT id FROM systems WHERE id = ?", (payload.system_id,))
    if not sys_exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")

    exists = db.db_read(
        "SELECT 1 FROM shelves WHERE system_id = ? AND label = ?",
        (payload.system_id, payload.label),
    )
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label already exists in this system")

    sid = db.db_write(
        """
        INSERT INTO shelves(system_id, label, length_mm, width_mm, height_mm, ordinal)
        VALUES(?, ?, ?, ?, ?, ?)
        """,
        (
            payload.system_id,
            payload.label,
            payload.length_mm,
            payload.width_mm,
            payload.height_mm,
            payload.ordinal or 1,
        ),
    )
    row = db.db_read(
        """
        SELECT id, system_id, label, length_mm, width_mm, height_mm, ordinal,
               is_deleted, created_at, updated_at
        FROM shelves WHERE id = ?
        """,
        (sid,),
    )[0]
    return dict(row)


@router.put("/shelves/{shelf_id}", response_model=ShelfOut, dependencies=[Depends(require_admin)])
def update_shelf(shelf_id: int, payload: ShelfIn):
    rows = db.db_read("SELECT id, system_id FROM shelves WHERE id = ?", (shelf_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")

    existing = db.db_read(
        "SELECT id FROM shelves WHERE system_id = ? AND label = ? AND id <> ?",
        (payload.system_id, payload.label, shelf_id),
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Label already exists in this system")

    db.db_write(
        """
        UPDATE shelves
        SET system_id = ?, label = ?, length_mm = ?, width_mm = ?, height_mm = ?, ordinal = ?, updated_at = datetime('now')
        WHERE id = ?
        """,
        (
            payload.system_id,
            payload.label,
            payload.length_mm,
            payload.width_mm,
            payload.height_mm,
            payload.ordinal or 1,
            shelf_id,
        ),
    )
    row = db.db_read(
        """
        SELECT id, system_id, label, length_mm, width_mm, height_mm, ordinal,
               is_deleted, created_at, updated_at
        FROM shelves WHERE id = ?
        """,
        (shelf_id,),
    )[0]
    return dict(row)


@router.delete("/shelves/{shelf_id}", status_code=204, dependencies=[Depends(require_admin)])
def soft_delete_shelf(shelf_id: int):
    rows = db.db_read("SELECT id, is_deleted FROM shelves WHERE id = ?", (shelf_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")
    if rows[0]["is_deleted"] == 1:
        return {"deleted": True}
    db.db_write(
        "UPDATE shelves SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?",
        (shelf_id,),
    )
    return {"deleted": True}


@router.post("/shelves/{shelf_id}/restore", response_model=ShelfOut, dependencies=[Depends(require_admin)])
def restore_shelf(shelf_id: int):
    rows = db.db_read("SELECT id FROM shelves WHERE id = ?", (shelf_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")
    db.db_write(
        "UPDATE shelves SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?",
        (shelf_id,),
    )
    row = db.db_read(
        """
        SELECT id, system_id, label, length_mm, width_mm, height_mm, ordinal,
               is_deleted, created_at, updated_at
        FROM shelves WHERE id = ?
        """,
        (shelf_id,),
    )[0]
    return dict(row)
