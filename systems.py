# systems.py
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from typing import Optional, List

import db
from auth import get_current_user, require_admin

router = APIRouter(tags=["systems"])


class SystemIn(BaseModel):
    code: str
    notes: Optional[str] = None

    @field_validator("code")
    @classmethod
    def code_trim(cls, v: str) -> str:
        v2 = v.strip()
        if not v2:
            raise ValueError("code is required")
        return v2


class SystemOut(BaseModel):
    id: int
    code: str
    notes: Optional[str]
    is_deleted: int
    created_at: str
    updated_at: str


@router.get("/systems", response_model=List[SystemOut])
def list_systems(
    include_deleted: bool = Query(False),
    _user=Depends(get_current_user),
):
    rows = db.db_read(
        """
        SELECT id, code, notes, is_deleted, created_at, updated_at
        FROM systems
        WHERE (? = 1 OR is_deleted = 0)
        ORDER BY code COLLATE NOCASE
        """,
        (1 if include_deleted else 0,),
    )
    return [dict(r) for r in rows]


@router.get("/systems/{system_id}", response_model=SystemOut)
def get_system(system_id: int, _user=Depends(get_current_user)):
    rows = db.db_read(
        "SELECT id, code, notes, is_deleted, created_at, updated_at FROM systems WHERE id = ?",
        (system_id,),
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    return dict(rows[0])


@router.post("/systems", response_model=SystemOut, status_code=201, dependencies=[Depends(require_admin)])
def create_system(payload: SystemIn):
    exists = db.db_read("SELECT 1 FROM systems WHERE code = ?", (payload.code,))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code already exists")
    sid = db.db_write(
        "INSERT INTO systems(code, notes) VALUES(?, ?)",
        (payload.code, payload.notes),
    )
    row = db.db_read(
        "SELECT id, code, notes, is_deleted, created_at, updated_at FROM systems WHERE id = ?",
        (sid,),
    )[0]
    return dict(row)


@router.put("/systems/{system_id}", response_model=SystemOut, dependencies=[Depends(require_admin)])
def update_system(system_id: int, payload: SystemIn):
    found = db.db_read("SELECT id FROM systems WHERE id = ?", (system_id,))
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")

    # if code is changing, enforce uniqueness
    existing = db.db_read("SELECT id FROM systems WHERE code = ? AND id <> ?", (payload.code, system_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code already exists")

    db.db_write(
        "UPDATE systems SET code = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
        (payload.code, payload.notes, system_id),
    )
    row = db.db_read(
        "SELECT id, code, notes, is_deleted, created_at, updated_at FROM systems WHERE id = ?",
        (system_id,),
    )[0]
    return dict(row)


@router.delete("/systems/{system_id}", status_code=204, dependencies=[Depends(require_admin)])
def soft_delete_system(system_id: int):
    rows = db.db_read("SELECT id, is_deleted FROM systems WHERE id = ?", (system_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    if rows[0]["is_deleted"] == 1:
        return {"deleted": True}
    db.db_write(
        "UPDATE systems SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?",
        (system_id,),
    )
    return {"deleted": True}


@router.post("/systems/{system_id}/restore", status_code=200, response_model=SystemOut, dependencies=[Depends(require_admin)])
def restore_system(system_id: int):
    rows = db.db_read("SELECT id FROM systems WHERE id = ?", (system_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    db.db_write(
        "UPDATE systems SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?",
        (system_id,),
    )
    row = db.db_read(
        "SELECT id, code, notes, is_deleted, created_at, updated_at FROM systems WHERE id = ?",
        (system_id,),
    )[0]
    return dict(row)
