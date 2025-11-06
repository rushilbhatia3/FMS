# movements.py
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from typing import Optional, List, Literal, Any, Dict, Sequence

import db
from auth import get_current_user, require_admin

router = APIRouter(tags=["movements"])


# ---------- Models ----------

Kind = Literal["receive", "issue", "return", "adjust", "transfer"]


class ReceiveIn(BaseModel):
    item_id: int
    shelf_id: int
    qty: int
    note: Optional[str] = None

    @field_validator("qty")
    @classmethod
    def qty_pos(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("qty must be > 0")
        return v


class IssueIn(BaseModel):
    item_id: int
    shelf_id: int
    qty: int
    holder: str
    due_at: Optional[str] = None
    note: Optional[str] = None

    @field_validator("qty")
    @classmethod
    def qty_pos(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("qty must be > 0")
        return v

    @field_validator("holder")
    @classmethod
    def holder_req(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("holder required")
        return v.strip()


class ReturnIn(BaseModel):
    item_id: int
    shelf_id: int
    qty: int
    holder: Optional[str] = None
    note: Optional[str] = None

    @field_validator("qty")
    @classmethod
    def qty_pos(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("qty must be > 0")
        return v


class AdjustIn(BaseModel):
    item_id: int
    shelf_id: int
    qty_delta: int
    note: str

    @field_validator("note")
    @classmethod
    def note_req(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("note required for adjust")
        return v.strip()


class TransferIn(BaseModel):
    item_id: int
    from_shelf_id: int
    to_shelf_id: int
    qty: int
    note: Optional[str] = None

    @field_validator("qty")
    @classmethod
    def qty_pos(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("qty must be > 0")
        return v

    @field_validator("to_shelf_id")
    @classmethod
    def shelves_diff(cls, v: int, info) -> int:
        data = info.data  # pydantic v2
        if "from_shelf_id" in data and v == data["from_shelf_id"]:
            raise ValueError("to_shelf_id must differ from from_shelf_id")
        return v


# ---------- Helpers ----------

def _user_max_cl(user: Dict[str, Any]) -> Optional[int]:
    return None if user["role"] == "admin" else user.get("max_clearance_level")


def _ensure_item_clearance(item_id: int, user: Dict[str, Any]) -> None:
    maxcl = _user_max_cl(user)
    rows = db.db_read(
        "SELECT clearance_level FROM items WHERE id = ?",
        (item_id,),
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    cl = rows[0]["clearance_level"]
    if maxcl is not None and cl > maxcl:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clearance denied")


def _exists(table: str, id_: int) -> None:
    rows = db.db_read(f"SELECT id FROM {table} WHERE id = ?", (id_,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{table} not found")


# ---------- List movements ----------

@router.get("/movements")
def list_movements(
    item_id: Optional[int] = Query(None),
    kind: Optional[Kind] = Query(None),
    holder: Optional[str] = Query(None),
    shelf_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None, description="inclusive, YYYY-MM-DD or full ts"),
    date_to: Optional[str] = Query(None, description="exclusive, YYYY-MM-DD or full ts"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    user=Depends(get_current_user),
):
    params: List[Any] = []
    where = ["1=1"]

    if item_id is not None:
        where.append("m.item_id = ?")
        params.append(item_id)
    if kind is not None:
        where.append("m.kind = ?")
        params.append(kind)
    if holder:
        where.append("m.holder = ?")
        params.append(holder)
    if shelf_id is not None:
        where.append("m.shelf_id = ?")
        params.append(shelf_id)
    if date_from:
        where.append("m.timestamp >= ?")
        params.append(date_from)
    if date_to:
        where.append("m.timestamp < ?")
        params.append(date_to)

    # Clearance gate
    maxcl = _user_max_cl(user)
    if maxcl is not None:
        where.append("i.clearance_level <= ?")
        params.append(maxcl)

    sql = f"""
    SELECT m.id, m.item_id, m.kind, m.quantity, m.shelf_id, m.holder, m.due_at,
           m.actor_user_id, m.note, m.timestamp
    FROM movements m
    JOIN items i ON i.id = m.item_id
    WHERE {' AND '.join(where)}
    ORDER BY m.timestamp DESC, m.id DESC
    LIMIT ? OFFSET ?
    """
    total_sql = f"""
    SELECT COUNT(1) AS total
    FROM movements m
    JOIN items i ON i.id = m.item_id
    WHERE {' AND '.join(where)}
    """
    total = db.db_read(total_sql, params)[0]["total"] if params is not None else 0
    offset = (page - 1) * page_size
    rows = db.db_read(sql, params + [page_size, offset])
    return {
        "items": [dict(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


# ---------- Receive ----------

@router.post("/movements/receive", status_code=201)
def receive(payload: ReceiveIn, user=Depends(get_current_user)):
    _ensure_item_clearance(payload.item_id, user)
    _exists("shelves", payload.shelf_id)
    qty_signed = payload.qty  # positive
    mid = db.db_write(
        """
        INSERT INTO movements(item_id, kind, quantity, shelf_id, actor_user_id, note)
        VALUES (?, 'receive', ?, ?, ?, ?)
        """,
        (payload.item_id, qty_signed, payload.shelf_id, user["id"], payload.note),
    )
    return {"id": mid, "kind": "receive"}


# ---------- Issue (checkout) ----------

@router.post("/movements/issue", status_code=201)
def issue(payload: IssueIn, user=Depends(get_current_user)):
    _ensure_item_clearance(payload.item_id, user)
    _exists("shelves", payload.shelf_id)
    qty_signed = -payload.qty  # negative
    mid = db.db_write(
        """
        INSERT INTO movements(item_id, kind, quantity, shelf_id, holder, due_at, actor_user_id, note)
        VALUES (?, 'issue', ?, ?, ?, ?, ?, ?)
        """,
        (payload.item_id, qty_signed, payload.shelf_id, payload.holder, payload.due_at, user["id"], payload.note),
    )
    return {"id": mid, "kind": "issue"}


# ---------- Return (check-in) ----------

@router.post("/movements/return", status_code=201)
def do_return(payload: ReturnIn, user=Depends(get_current_user)):
    _ensure_item_clearance(payload.item_id, user)
    _exists("shelves", payload.shelf_id)
    qty_signed = payload.qty  # positive
    mid = db.db_write(
        """
        INSERT INTO movements(item_id, kind, quantity, shelf_id, holder, actor_user_id, note)
        VALUES (?, 'return', ?, ?, ?, ?, ?)
        """,
        (payload.item_id, qty_signed, payload.shelf_id, payload.holder, user["id"], payload.note),
    )
    return {"id": mid, "kind": "return"}


# ---------- Adjust (admin only) ----------

@router.post("/movements/adjust", status_code=201, dependencies=[Depends(require_admin)])
def adjust(payload: AdjustIn, user=Depends(get_current_user)):
    _exists("items", payload.item_id)
    _exists("shelves", payload.shelf_id)
    mid = db.db_write(
        """
        INSERT INTO movements(item_id, kind, quantity, shelf_id, actor_user_id, note)
        VALUES (?, 'adjust', ?, ?, ?, ?)
        """,
        (payload.item_id, payload.qty_delta, payload.shelf_id, user["id"], payload.note),
    )
    return {"id": mid, "kind": "adjust"}


# ---------- Transfer (two rows, atomic) ----------

@router.post("/movements/transfer", status_code=201)
def transfer(payload: TransferIn, user=Depends(get_current_user)):
    _ensure_item_clearance(payload.item_id, user)
    _exists("shelves", payload.from_shelf_id)
    _exists("shelves", payload.to_shelf_id)

    params: Sequence[Sequence[Any]] = [
        (payload.item_id, -payload.qty, payload.from_shelf_id, user["id"], payload.note),
        (payload.item_id,  payload.qty, payload.to_shelf_id,   user["id"], payload.note),
    ]
    db.db_execmany(
        """
        INSERT INTO movements(item_id, kind, quantity, shelf_id, actor_user_id, note)
        VALUES (?, 'transfer', ?, ?, ?, ?)
        """,
        params,
    )
    return {"transferred": payload.qty, "from_shelf_id": payload.from_shelf_id, "to_shelf_id": payload.to_shelf_id}
