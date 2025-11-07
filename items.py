from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator, Field
from typing import Optional, List, Literal, Dict, Any, Tuple
import db
from auth import get_current_user, require_admin

router = APIRouter(tags=["items"])

# ---------- Pydantic models ----------
class ItemCreate(BaseModel):
    sku: str
    name: str
    unit: str = "units"
    clearance_level: int = Field(..., ge=1, le=4)
    system_code: str = Field(..., min_length=1, max_length=64)
    shelf_label: str = Field(..., min_length=1, max_length=64)
    quantity: int = Field(..., ge=0)

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
    shelf_id: Optional[int] = None
    tag: Optional[str] = None
    note: Optional[str] = None


class ItemOut(BaseModel):
    id: int
    sku: str
    name: str
    unit: str
    clearance_level: int
    quantity: int
    is_deleted: int
    shelf_id: Optional[int] = None
    shelf_label: Optional[str] = None
    system_code: Optional[str] = None
    is_out: int = 0
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
    "quantity": "quantity",
    "clearance_level": "clearance_level",
    "system_code": "system_code",
    "shelf_label": "shelf_label",
}

def _sort_clause(sort: str, direction: str) -> str:
    col = ALLOWED_SORTS.get(sort, "last_movement_ts")
    dir_sql = "DESC" if direction.lower() == "desc" else "ASC"
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
    sort: str = Query("last_movement_ts"),
    dir: Literal["asc", "desc"] = Query("desc", alias="dir"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    user=Depends(get_current_user),
):
    user_maxCL = _current_user_clearance(user)

    # Normalize inputs
    params = {
        "maxCL": user_maxCL,                         # None means unlimited
        "include_del": 1 if include_deleted else 0,
        "system_code": (system_code or "").strip(),
        "shelf_label": (shelf_label or "").strip(),
        "status": (status_filter or "").strip(),     # '', 'available', 'checked_out'
        "min_qty": min_qty,
        "max_qty": max_qty,
        "holder": (holder or "").strip(),
        "q": (q or "").strip(),
    }

    # One CTE with all filters (FTS + holder guarded so empty values don't exclude everything)
    filtered_cte = """
    WITH filtered AS (
      SELECT isc.*
      FROM item_status_current isc
      WHERE (:maxCL IS NULL OR isc.clearance_level <= :maxCL)
        AND (:include_del = 1 OR isc.is_deleted = 0)
        AND (:system_code = '' OR isc.system_code = :system_code)
        AND (:shelf_label = '' OR isc.shelf_label = :shelf_label)
        AND (
              :status = ''
           OR (:status = 'available'    AND isc.is_out = 0)
           OR (:status = 'checked_out'  AND isc.is_out = 1)
        )
        AND (:min_qty IS NULL OR isc.quantity >= :min_qty)
        AND (:max_qty IS NULL OR isc.quantity <= :max_qty)
        AND (:holder = '' OR EXISTS (
              SELECT 1 FROM current_out_by_holder h
              WHERE h.item_id = isc.item_id AND h.holder = :holder
            ))
        AND (:q = '' OR isc.item_id IN (
              SELECT rowid FROM items_fts WHERE items_fts MATCH :q
            ))
    )
    """

    # Total
    count_sql = filtered_cte + "SELECT COUNT(1) AS total FROM filtered;"
    total_rows = db.db_read(count_sql, params)
    total = int(total_rows[0]["total"]) if total_rows else 0

    # Sorting
    def _sort_clause_safe(col: str, direction: str) -> str:
        direction = "ASC" if str(direction).lower() == "asc" else "DESC"
        allowed = {
            "last_movement_ts": "last_movement_ts",
            "created_at":       "created_at",
            "name":             "name",
            "sku":              "sku",
            "quantity":         "quantity",
            "clearance_level":  "clearance_level",
            "system_code":      "system_code",
            "shelf_label":      "shelf_label",
        }
        key = allowed.get(col, "last_movement_ts")
        return f"{key} {direction}"

    order_clause = _sort_clause_safe(sort, dir)

    # Page
    params_page = dict(params)
    params_page.update({
        "limit": page_size,
        "offset": (page - 1) * page_size,
    })

    page_sql = filtered_cte + f"""
    SELECT
      item_id,
      sku,
      name,
      unit,
      clearance_level,
      quantity,
      is_deleted,
      shelf_id,
      shelf_label,
      system_code,
      is_out,
      last_issue_ts,
      last_return_ts,
      last_movement_ts
    FROM filtered
    ORDER BY {order_clause}
    LIMIT :limit OFFSET :offset;
    """

    rows = db.db_read(page_sql, params_page)

    items = [
        {
            "id": r["item_id"],
            "sku": r["sku"],
            "name": r["name"],
            "unit": r["unit"],
            "clearance_level": r["clearance_level"],
            "quantity": r["quantity"],
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
          i.id, i.sku, i.name, i.unit, i.clearance_level, i.quantity,
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
        "quantity": r["quantity"],
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


@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(payload: ItemCreate, user=Depends(get_current_user)):

    _enforce_clearance_for_create(user, int(payload.clearance_level))

    shelf_id = _resolve_shelf_id(payload.system_code, payload.shelf_label)

    # ----------------- CREATE ITEM -----------------
    try:
        sql = """
            INSERT INTO items
            (sku, name, unit, clearance_level, quantity, shelf_id, tag, note, created_at, updated_at, is_deleted, added_by)
            VALUES
            (:sku, :name, :unit, :clearance_level, 0, :shelf_id, :tag, :note, datetime('now'), datetime('now'), 0, :added_by)
        """
        params = {
            "sku": payload.sku,
            "name": payload.name,
            "unit": payload.unit or None,
            "clearance_level": int(payload.clearance_level),
            "shelf_id": shelf_id,
            "tag": payload.tag or None,
            "note": payload.note or None,
            "added_by": (user.get("email") or user.get("name") or "system"),
        }
        item_id = db.db_write(sql, params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"failed to insert item: {e}")

    # ----------------- SEED INITIAL QUANTITY (replace your old block with this one) -----------------
    initial_qty = int(payload.quantity or 0)
    if initial_qty > 0:
        try:
            # Discover movements columns so we don't mismatch placeholders
            cols_rows = db.db_read("PRAGMA table_info('movements');")
            mov_cols = {r["name"] for r in cols_rows}

            # Base cols we want to write
            cols = ["item_id", "qty", "type", "operator_name", "note"]
            values = {
                "item_id": item_id,
                "qty": initial_qty,
                "type": "receive",
                "operator_name": (user.get("email") or user.get("name") or "system"),
                "note": "initial receive on create" if not payload.note else f"create: {payload.note}",
            }

            # Add shelf_id only if the column exists
            if "shelf_id" in mov_cols and shelf_id is not None:
                cols.insert(3, "shelf_id")  # put it before operator_name
                values["shelf_id"] = shelf_id

            # (timestamp has a DEFAULT, so we don't need to pass it)
            # Build named-parameter SQL so order can't drift
            placeholders = ", ".join([f":{c}" for c in cols])
            col_list     = ", ".join(cols)
            sql = f"INSERT INTO movements ({col_list}) VALUES ({placeholders})"

            db.db_write(sql, values)

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"item created but failed to record initial movement: {e}"
            )
    # ----------------- RETURN CREATED RECORD -----------------
    row = db.db_read(
        """
        SELECT i.id, i.sku, i.name, i.unit, i.clearance_level, i.quantity,
               COALESCE(sys.code,'') AS system_code,
               COALESCE(sh.label,'') AS shelf_label,
               i.is_deleted
        FROM items i
        LEFT JOIN shelves sh ON sh.id = i.shelf_id
        LEFT JOIN systems sys ON sys.id = sh.system_id
        WHERE i.id = ?
        """,
        (item_id,),
    )
    if not row:
        raise HTTPException(status_code=500, detail="created item not found")
    r = row[0]
    return ItemOut(
        id=int(r["id"]),
        sku=r["sku"],
        name=r["name"],
        unit=r["unit"],
        clearance_level=int(r["clearance_level"]),
        quantity=int(r["quantity"]),
        system_code=r["system_code"],
        shelf_label=r["shelf_label"],
        is_deleted=int(r["is_deleted"]),
    )


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
        raise HTTPException(status_code=404, detail="Item not found or not permitted")

    rows = db.db_read(
        """
        SELECT
          id,
          item_id,
          movement_type,
          quantity,
          COALESCE(from_shelf_id, shelf_id) AS from_shelf_id,
          to_shelf_id,
          operator_name,
          COALESCE(holder_name, holder) AS holder,  -- support either column name
          due_at,
          note,
          timestamp
        FROM movements
        WHERE item_id = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT 10
        """,
        (item_id,),
    )
    return [dict(r) for r in rows]


# ---- Helpers ----
def _enforce_clearance_for_create(user: dict, cl: int):
    maxCL = user.get("max_clearance_level")
    role = (user.get("role") or "").lower()
    if role == "admin":
        return
    if maxCL is None:
        return
    if cl > int(maxCL):
        raise HTTPException(status_code=403, detail=f"clearance_level {cl} exceeds your max_clearance_level {maxCL}")

def _resolve_shelf_id(system_code: str, shelf_label: str) -> int:
    rows = db.db_read(
        """
        SELECT sh.id
        FROM shelves sh
        JOIN systems sys ON sys.id = sh.system_id
        WHERE LOWER(TRIM(sys.code)) = LOWER(TRIM(?))
          AND LOWER(TRIM(sh.label)) = LOWER(TRIM(?))
          AND COALESCE(sys.is_deleted,0) = 0
          AND COALESCE(sh.is_deleted,0) = 0
        LIMIT 1
        """,
        (system_code, shelf_label),
    )
    if not rows:
        raise HTTPException(status_code=400,
            detail="Invalid system_code or shelf_label (not found or deleted)")
    return int(rows[0]["id"])
