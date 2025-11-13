import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from typing import Optional, List

import db
from auth import get_current_user, require_admin

router = APIRouter(prefix="/systems", tags=["systems"])

# ---------- Models ----------
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
    notes: Optional[str] = None
    is_deleted: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None  # populated after migration

class SystemUpdate(BaseModel):
    code: Optional[str] = None
    notes: Optional[str] = None

# ---------- Helpers ----------
def _get_system_row(system_id: int) -> Optional[sqlite3.Row]:
    rows = db.db_read(
        "SELECT id, code, notes, is_deleted, created_at, updated_at, deleted_at FROM systems WHERE id=?",
        (system_id,),
    )
    return rows[0] if rows else None

# ---------- Routes ----------
@router.get("", response_model=List[SystemOut])
def list_systems(
    include_deleted: bool = Query(False),
    _user = Depends(get_current_user),
):
    rows = db.db_read(
        """
        SELECT id, code, notes, is_deleted, created_at, updated_at, deleted_at
          FROM systems
         WHERE (? = 1 OR is_deleted = 0)
         ORDER BY code COLLATE NOCASE
        """,
        (1 if include_deleted else 0,),
    )
    return [dict(r) for r in rows]

@router.get("/{system_id}", response_model=SystemOut)
def get_system(system_id: int, _user = Depends(get_current_user)):
    row = _get_system_row(system_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    return dict(row)

@router.post("", response_model=SystemOut, status_code=201, dependencies=[Depends(require_admin)])
def create_system(payload: SystemIn):
    exists = db.db_read("SELECT 1 FROM systems WHERE code = ?", (payload.code,))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code already exists")

    sid = db.db_write(
        "INSERT INTO systems(code, notes) VALUES(?, ?)",
        (payload.code, payload.notes),
    )
    row = _get_system_row(sid)
    return dict(row)

@router.put("/{system_id}", response_model=SystemOut, dependencies=[Depends(require_admin)])
def update_system(system_id: int, payload: SystemIn):
    if not _get_system_row(system_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")

    # enforce unique code 
    clash = db.db_read("SELECT id FROM systems WHERE code = ? AND id <> ?", (payload.code, system_id))
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code already exists")

    db.db_write(
        "UPDATE systems SET code = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (payload.code, payload.notes, system_id),
    )
    row = _get_system_row(system_id)
    return dict(row)

@router.delete("/{system_id}", status_code=204, dependencies=[Depends(require_admin)])
def soft_delete_system(system_id: int, _user = Depends(require_admin)):
    row = _get_system_row(system_id)
    if not row:
        raise HTTPException(status_code=404, detail="system not found")
    if row["is_deleted"] == 1:
        return

    db.db_write(
        """
        UPDATE systems
           SET is_deleted = 1,
               deleted_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
        """,
        (system_id,),
    )
    return  # 204

@router.post("/{system_id}/restore", response_model=SystemOut, dependencies=[Depends(require_admin)])
def restore_system(system_id: int):
    row = _get_system_row(system_id)
    if not row:
        raise HTTPException(status_code=404, detail="system not found")
    if row["is_deleted"] == 0:
        return dict(row)

    db.db_write(
        """
        UPDATE systems
           SET is_deleted = 0,
               deleted_at = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
        """,
        (system_id,),
    )
    return dict(_get_system_row(system_id))
