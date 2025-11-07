from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from typing import Optional, List, Literal, Dict, Any, Tuple

import db
from auth import get_current_user, require_admin

router = APIRouter(tags=["items"])

# ---------- Pydantic models ----------

class ItemCreate(BaseModel):
    sku: str
    name: str
    unit: str = "units"
    clearance_level: int
    home_shelf_id: Optional[int] = None
    tag: Optional[str] = None
    note: Optional[str] = None

    @field_validator("sku", "name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not str(v).strip():
            raise ValueError("Required field cannot be blank")
        return v.strip()

    @field_validator("clearance_level")
    @classmethod
    def cl_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("clearance_level must be >= 1")
        return v


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    clearance_level: Optional[int] = None
    home_shelf_id: Optional[int] = None
    tag: Optional[str] = None
    note: Optional[str] = None


class ItemOut(BaseModel):
    id: int
    sku: str
    name: str
    unit: str
    clearance_level: int
    quantity_on_hand: int
    is_deleted: int
    shelf_id: Optional[int] = None
    shelf_label: Optional[str] = None
    system_code: Optional[str] = None
    is_out: int
    last_issue_ts: Optional[str] = None
    last_return_ts: Optional[str] = None
    last_movement_ts: Optional[str] = None


class ItemDetailOut(ItemOut):
    tag: Optional[str] = None
    note: Optional[str] = None
    created_at: str
    updated_at: str


class PaginatedItems(BaseModel):
    items: List[ItemOut]
    page: int
    page_size: int
    total: int


# ---------- Helpers ----------

ALLOWED_SORTS = {
    "name": "name",
    "sku": "sku",
    "last_movement_ts": "last_movement_ts",
    "quantity_on_hand": "quantity_on_hand",
    "clearance_level": "clearance_level",
    "system_code": "system_code",
    "shelf_label": "shelf_label",
}

def _sort_clause(sort: str, direction: str) -> str:
    col = ALLOWED_SORTS.get(sort, "created_at")
    dir_sql = "DESC" if direction.lower() == "desc" else "ASC"
    # name/sku/shelf/system sorts should be case-insensitive
    if col in ("name", "sku", "shelf_label", "system_code"):
        return f"{col} COLLATE NOCASE {dir_sql}, item_id ASC"
    return f"{col} {dir_sql}, item_id ASC"

def _current_user_clearance(user: Dict[str, Any]) -> Optional[int]:
    if user["role"] == "admin":
        return None
    return user.get("max_clearance_level")


# ---------- Endpoints ----------

@router.get("/items", response_model=PaginatedItems)
def list_items(
    q: str = Query("", description="FTS query over sku/name/tag/note"),
    status_filter: Literal["", "available", "checked_out"] = Query("", alias="status"),
    include_deleted: bool = Query(False),
    system_code: str = Query(""),
    shelf_label: str = Query(""),
    holder: str = Query(""),
    min_qty: Optional[int] = Query(None),
    max_qty: Optional[int] = Query(None),
    sort: str = Query("last_movement_ts"),   # <-- was "created_at"
    dir: Literal["asc", "desc"] = Query("desc", alias="dir"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    user=Depends(get_current_user),
):
    user_maxCL = _current_user_clearance(user)

    # ---------- CTE stack ----------
    base_cte = """
    WITH base AS (
      SELECT isc.*
      FROM item_status_current isc
      WHERE (? IS NULL OR isc.clearance_level <= ?)
        AND (? = 1 OR isc.is_deleted = 0)
        AND (? = '' OR isc.system_code = ?)
        AND (? = '' OR isc.shelf_label = ?)
        AND (
              ? = ''
           OR (? = 'available'   AND isc.is_out = 0)
           OR (? = 'checked_out' AND isc.is_out = 1)
        )
        AND (? IS NULL OR isc.quantity_on_hand >= ?)
        AND (? IS NULL OR isc.quantity_on_hand <= ?)
    ),
    searched AS (
      SELECT b.* FROM base b WHERE (? = '')
      UNION ALL
      SELECT b.* FROM base b
      JOIN items_fts ON items_fts.rowid = b.item_id
      WHERE (? <> '' AND items_fts MATCH ?)
    ),
    holder_filtered AS (
      SELECT s.* FROM searched s WHERE (? = '')
      UNION ALL
      SELECT s.* FROM searched s
      WHERE (? <> '')
        AND EXISTS (
          SELECT 1 FROM current_out_by_holder h
          WHERE h.item_id = s.item_id AND h.holder = ?
        )
    )
    """

    # ---------- Build parameters in exact placeholder order ----------
    maxCL = None if user_maxCL is None else user_maxCL
    inc_del = 1 if include_deleted else 0
    sys_code = system_code or ""
    sh_label = shelf_label or ""
    stat = status_filter or ""
    qstr = q or ""
    holder_str = holder or ""

    # base CTE (14 placeholders)
    base_params = [
        maxCL, maxCL,                 # (? IS NULL OR isc.clearance_level <= ?)
        inc_del,                      # (? = 1 OR isc.is_deleted = 0)
        sys_code, sys_code,           # (? = '' OR isc.system_code = ?)
        sh_label, sh_label,           # (? = '' OR isc.shelf_label = ?)
        stat, stat, stat,             # ? = '' OR (?='available') OR (?='checked_out')
        min_qty, min_qty,             # (? IS NULL OR isc.quantity_on_hand >= ?)
        max_qty, max_qty,             # (? IS NULL OR isc.quantity_on_hand <= ?)
    ]

    # searched CTE (3 placeholders)
    search_params = [
        qstr,                         # (? = '')
        qstr, qstr,                   # (? <> '' AND items_fts MATCH ?)
    ]

    # holder_filtered CTE (3 placeholders)
    holder_params = [
        holder_str,                   # (? = '')
        holder_str, holder_str,       # (? <> '') AND holder = ?
    ]

    where_params_full = tuple(base_params + search_params + holder_params)

    # ---------- Total count ----------
    count_sql = base_cte + "SELECT COUNT(1) AS total FROM holder_filtered;"
    total_rows = db.db_read(count_sql, where_params_full)
    total = int(total_rows[0]["total"]) if total_rows else 0

    # ---------- Page query ----------
    offset = (page - 1) * page_size
    order_clause = _sort_clause(sort, dir)
    page_sql = base_cte + f"""
    SELECT
      item_id,
      sku,
      name,
      unit,
      clearance_level,
      quantity_on_hand,
      is_deleted,
      shelf_id,
      shelf_label,
      system_code,
      is_out,
      last_issue_ts,
      last_return_ts,
      last_movement_ts
    FROM holder_filtered
    ORDER BY {order_clause}
    LIMIT ? OFFSET ?;
    """
    rows = db.db_read(page_sql, where_params_full + (page_size, offset))

    items = [
        {
            "id": r["item_id"],
            "sku": r["sku"],
            "name": r["name"],
            "unit": r["unit"],
            "clearance_level": r["clearance_level"],
            "quantity_on_hand": r["quantity_on_hand"],
            "is_deleted": r["is_deleted"],
            "shelf_id": r["shelf_id"],
            "shelf_label": r["shelf_label"],
            "system_code": r["system_code"],
            "is_out": r["is_out"],
            "last_issue_ts": r["last_issue_ts"],
            "last_return_ts": r["last_return_ts"],
            "last_movement_ts": r["last_movement_ts"],
        }
        for r in rows
    ]
    return {"items": items, "page": page, "page_size": page_size, "total": total}
@router.get("/items/{item_id}", response_model=ItemDetailOut)
def get_item(item_id: int, user=Depends(get_current_user)):
    user_maxCL = _current_user_clearance(user)
    row = db.db_read(
        """
        SELECT
          i.id, i.sku, i.name, i.unit, i.clearance_level, i.quantity_on_hand,
          i.tag, i.note, i.is_deleted, i.created_at, i.updated_at,
          isc.shelf_id, isc.shelf_label, isc.system_code, isc.is_out,
          isc.last_issue_ts, isc.last_return_ts, isc.last_movement_ts
        FROM items i
        LEFT JOIN item_status_current isc ON isc.item_id = i.id
        WHERE i.id = ?
          AND (? IS NULL OR i.clearance_level <= ?)
        """,
        (item_id, None if user_maxCL is None else user_maxCL, None if user_maxCL is None else user_maxCL),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found or not permitted")
    r = row[0]
    return {
        "id": r["id"],
        "sku": r["sku"],
        "name": r["name"],
        "unit": r["unit"],
        "clearance_level": r["clearance_level"],
        "quantity_on_hand": r["quantity_on_hand"],
        "is_deleted": r["is_deleted"],
        "shelf_id": r["shelf_id"],
        "shelf_label": r["shelf_label"],
        "system_code": r["system_code"],
        "is_out": r["is_out"],
        "last_issue_ts": r["last_issue_ts"],
        "last_return_ts": r["last_return_ts"],
        "last_movement_ts": r["last_movement_ts"],
        "tag": r["tag"],
        "note": r["note"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


@router.post("/items", response_model=ItemDetailOut, status_code=201, dependencies=[Depends(require_admin)])
def create_item(payload: ItemCreate):
    # Uniqueness
    exists = db.db_read("SELECT 1 FROM items WHERE sku = ?", (payload.sku.strip(),))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SKU already exists")

    # Home shelf (optional) must exist if provided
    if payload.home_shelf_id is not None:
        sh = db.db_read("SELECT id FROM shelves WHERE id = ?", (payload.home_shelf_id,))
        if not sh:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")

    item_id = db.db_write(
        """
        INSERT INTO items(sku, name, unit, clearance_level, home_shelf_id, tag, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.sku.strip(),
            payload.name.strip(),
            payload.unit.strip() if payload.unit else "units",
            payload.clearance_level,
            payload.home_shelf_id,
            (payload.tag or None),
            (payload.note or None),
        ),
    )
    # Return detail
    return get_item(item_id)


@router.put("/items/{item_id}", response_model=ItemDetailOut, dependencies=[Depends(require_admin)])
def update_item(item_id: int, payload: ItemUpdate):
    found = db.db_read("SELECT id FROM items WHERE id = ?", (item_id,))
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    # Validate shelf if changing
    if payload.home_shelf_id is not None:
        sh = db.db_read("SELECT id FROM shelves WHERE id = ?", (payload.home_shelf_id,))
        if not sh:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shelf not found")

    sets = []
    params: List[Any] = []

    if payload.name is not None:
        sets.append("name = ?")
        params.append(payload.name.strip())
    if payload.unit is not None:
        sets.append("unit = ?")
        params.append(payload.unit.strip())
    if payload.clearance_level is not None:
        if payload.clearance_level < 1:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="clearance_level must be >= 1")
        sets.append("clearance_level = ?")
        params.append(payload.clearance_level)
    if payload.home_shelf_id is not None:
        sets.append("home_shelf_id = ?")
        params.append(payload.home_shelf_id)
    if payload.tag is not None:
        sets.append("tag = ?")
        params.append(payload.tag)
    if payload.note is not None:
        sets.append("note = ?")
        params.append(payload.note)

    if not sets:
        return get_item(item_id)

    params.append(item_id)
    db.db_write(f"UPDATE items SET {', '.join(sets)}, updated_at = datetime('now') WHERE id = ?", params)
    return get_item(item_id)


@router.delete("/items/{item_id}", status_code=204, dependencies=[Depends(require_admin)])
def soft_delete_item(item_id: int):
    row = db.db_read("SELECT id, is_deleted FROM items WHERE id = ?", (item_id,))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if row[0]["is_deleted"] == 1:
        return {"deleted": True}
    db.db_write("UPDATE items SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?", (item_id,))
    return {"deleted": True}


@router.post("/items/{item_id}/restore", response_model=ItemDetailOut, dependencies=[Depends(require_admin)])
def restore_item(item_id: int):
    found = db.db_read("SELECT id FROM items WHERE id = ?", (item_id,))
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    db.db_write("UPDATE items SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?", (item_id,))
    return get_item(item_id)


@router.get("/items/{item_id}/movements")
def item_movements(item_id: int, user=Depends(get_current_user)):
    # Clearance check
    user_maxCL = _current_user_clearance(user)
    allowed = db.db_read(
        "SELECT 1 FROM items WHERE id = ? AND (? IS NULL OR clearance_level <= ?)",
        (item_id, None if user_maxCL is None else user_maxCL, None if user_maxCL is None else user_maxCL),
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found or not permitted")

    rows = db.db_read(
        """
        SELECT id, item_id, kind, quantity, shelf_id, holder, due_at, actor_user_id, note, timestamp
        FROM latest_item_movements
        WHERE item_id = ?
        ORDER BY timestamp DESC, id DESC
        """,
        (item_id,),
    )
    return [dict(r) for r in rows]
